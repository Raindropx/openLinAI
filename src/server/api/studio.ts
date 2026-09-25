import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { STUDIO_MAX_FILE_BYTES, type StudioItem } from '../../shared/studio'
import { civitaiSiteBaseUrl } from '../../shared/civitai-generation'
import {
  NOVELAI_IMAGE_MODELS,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
  type CivitaiModelSearchResult,
  type CivitaiModelSummary,
} from '../../shared/studio-generation'
import { studioManager, studioMimeType } from '../common/studio-manager'
import { studioProviderSettings } from '../common/studio-provider-settings'
import { taskManager } from '../common/task-manager'
import { INPUT_IMAGES_DIR } from '../common/static'
import { INPUT_IMAGES_API_PATH } from '../common/static/enum'
import { handleNovelAIImageGeneration } from '../module/gpt-image/novelai-image'
import { fetchWithTimeout } from '../module/utils/fetch'
import { civitaiGenerateSchema, civitaiGenerationManager } from '../module/civitai-generation'

const idSchema = z.object({ id: z.string().uuid() })
const NOVELAI_IMAGE_API_BASE_URL = 'https://image.novelai.net'
const apiKeySchema = z.string().trim().min(1).max(4096)
const providerUpdateSchema = z.object({
  apiKey: apiKeySchema.optional(),
  clearApiKey: z.boolean().optional(),
})
const dimensionSchema = z
  .number()
  .int()
  .min(64)
  .max(2048)
  .refine((value) => value % 64 === 0, '尺寸必须是 64 的倍数')
const inputImageUrlSchema = z
  .string()
  .max(1000)
  .refine((value) => {
    const prefix = `${INPUT_IMAGES_API_PATH}/`
    if (!value.startsWith(prefix) || /[?#]/.test(value)) return false
    const filename = value.slice(prefix.length)
    return Boolean(filename) && filename === filename.split('/').pop()
  }, '参考图必须是已上传的本地图片')
const novelaiGenerateSchema = z.object({
  title: z.string().trim().max(120).optional(),
  prompt: z.string().trim().min(1, '提示词不能为空').max(20000),
  negativePrompt: z.string().max(20000).default(''),
  model: z.enum(
    NOVELAI_IMAGE_MODELS.map((model) => model.id) as [
      (typeof NOVELAI_IMAGE_MODELS)[number]['id'],
      ...(typeof NOVELAI_IMAGE_MODELS)[number]['id'][],
    ],
  ),
  width: dimensionSchema,
  height: dimensionSchema,
  steps: z.number().int().min(1).max(50),
  scale: z.number().min(0).max(10),
  cfgRescale: z.number().min(0).max(1),
  sampler: z.enum(NOVELAI_SAMPLERS),
  noiseSchedule: z.enum(NOVELAI_NOISE_SCHEDULES),
  seed: z.number().int().min(-1).max(0x7fffffff),
  n: z.number().int().min(1).max(4),
  qualityToggle: z.boolean(),
  qualityPreset: z.enum(['none', 'light', 'standard']).optional(),
  ucPreset: z.number().int().min(0).max(4).optional(),
  action: z.enum(['generate', 'img2img', 'infill']).optional(),
  referenceImageUrl: inputImageUrlSchema.optional(),
  maskImageUrl: inputImageUrlSchema.optional(),
  inpaintBase: z.enum(['original', 'blur']).optional(),
  focusedInpaint: z.boolean().optional(),
  inpaintContextPixels: z.number().int().min(32).max(512).optional(),
  inpaintBlendMode: z.enum(['strict', 'soft']).optional(),
  inpaintFeatherPixels: z.number().int().min(4).max(32).optional(),
  saveInpaintRaw: z.boolean().optional(),
  preciseReference: z.object({
    imageUrl: inputImageUrlSchema,
    type: z.enum(['character', 'style', 'character-and-style']),
    strength: z.number().min(0).max(1),
    fidelity: z.number().min(0).max(1),
  }).optional(),
  strength: z.number().min(0).max(1).default(0.7),
  noise: z.number().min(0).max(1).default(0.1),
  saveToTaskList: z.boolean().default(false),
  characters: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(10000),
        negativePrompt: z.string().max(10000).default(''),
        position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
      }),
    )
    .max(22),
}).superRefine((value, ctx) => {
  if (value.action === 'img2img' && !value.referenceImageUrl)
    ctx.addIssue({ code: 'custom', path: ['referenceImageUrl'], message: '图生图需要参考图' })
  if (value.action === 'infill' && (!value.referenceImageUrl || !value.maskImageUrl))
    ctx.addIssue({ code: 'custom', path: ['maskImageUrl'], message: '局部重绘需要参考图和遮罩' })
  if (value.preciseReference && !value.model.startsWith('nai-diffusion-4-5-'))
    ctx.addIssue({ code: 'custom', path: ['preciseReference'], message: '精密参考仅支持 V4.5' })
  if (value.action === 'infill' && value.model === 'nai-diffusion-5-curated')
    ctx.addIssue({ code: 'custom', path: ['model'], message: 'V5 Curated 暂无原生局部重绘' })
})

function apiError(data: unknown, fallback: string) {
  if (!data || typeof data !== 'object') return fallback
  const record = data as { error?: unknown; message?: unknown }
  if (typeof record.error === 'string') return record.error
  if (typeof record.message === 'string') return record.message
  return fallback
}

async function readJson(response: Response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return {}
  }
}

interface CivitaiApiModel {
  id?: number
  name?: string
  type?: string
  nsfw?: boolean
  supportsGeneration?: boolean
  creator?: { username?: string }
  modelVersions?: Array<{
    id?: number
    name?: string
    baseModel?: string
    supportsGeneration?: boolean
    trainedWords?: string[]
    images?: Array<{ url?: string; nsfw?: boolean }>
  }>
}

const studioApi = new Hono()
  .onError((error, c) =>
    c.json(
      { success: false as const, error: error.message || '工作室操作失败' },
      400,
    ),
  )
  .get('/items', async (c) =>
    c.json({ success: true as const, data: await studioManager.list() }),
  )
  .get('/providers', async (c) =>
    c.json({
      success: true as const,
      data: await studioProviderSettings.publicSettings(),
    }),
  )
  .put(
    '/providers/novelai',
    zValidator(
      'json',
      providerUpdateSchema.extend({
        model: z
          .enum(
            NOVELAI_IMAGE_MODELS.map((model) => model.id) as [
              (typeof NOVELAI_IMAGE_MODELS)[number]['id'],
              ...(typeof NOVELAI_IMAGE_MODELS)[number]['id'][],
            ],
          )
          .optional(),
      }),
    ),
    async (c) =>
      c.json({
        success: true as const,
        data: await studioProviderSettings.updateNovelAI(c.req.valid('json')),
      }),
  )
  .put(
    '/providers/civitai',
    zValidator('json', providerUpdateSchema),
    async (c) =>
      c.json({
        success: true as const,
        data: await studioProviderSettings.updateCivitai(c.req.valid('json')),
      }),
  )
  .post('/providers/novelai/test', async (c) => {
    const { apiKey } = await studioProviderSettings.novelai()
    const response = await fetchWithTimeout(
      `${NOVELAI_IMAGE_API_BASE_URL}/user/subscription`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      15000,
    )
    const data = await readJson(response)
    if (!response.ok)
      throw new Error(apiError(data, `NovelAI 验证失败 (${response.status})`))
    const steps = data && typeof data === 'object'
      ? (data as { trainingStepsLeft?: { fixedTrainingStepsLeft?: unknown; purchasedTrainingSteps?: unknown } }).trainingStepsLeft
      : undefined
    const fixed = steps?.fixedTrainingStepsLeft
    const purchased = steps?.purchasedTrainingSteps
    const anlas = typeof fixed === 'number' && typeof purchased === 'number' && Number.isFinite(fixed + purchased)
      ? fixed + purchased : undefined
    return c.json({ success: true as const, data: { connected: true, anlas } })
  })
  .post('/providers/civitai/test', async (c) => {
    const { apiKey } = await studioProviderSettings.civitai()
    const response = await fetchWithTimeout(
      'https://civitai.com/api/v1/me',
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      15000,
    )
    const data = await readJson(response)
    if (!response.ok)
      throw new Error(apiError(data, `Civitai 验证失败 (${response.status})`))
    const username =
      data && typeof data === 'object' && 'username' in data
        ? String((data as { username?: unknown }).username || '')
        : ''
    return c.json({
      success: true as const,
      data: { connected: true, username: username || undefined },
    })
  })
  .post('/providers/novelai/mask', bodyLimit({
    maxSize: 16 * 1024 * 1024,
    onError: (c) => c.json({ success: false as const, error: '遮罩不能超过 16 MiB' }, 413),
  }), async (c) => {
    const maxBytes = 16 * 1024 * 1024
    const statedBytes = Number(c.req.header('content-length') || 0)
    if (statedBytes > maxBytes) throw new Error('遮罩不能超过 16 MiB')
    const buffer = Buffer.from(await c.req.arrayBuffer())
    if (buffer.length > maxBytes || buffer.length < 24 ||
      !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('遮罩必须为不超过 16 MiB 的 PNG')
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    if (!width || !height || width > 2048 || height > 2048)
      throw new Error('遮罩尺寸无效或超过 2048 像素')
    await fs.ensureDir(INPUT_IMAGES_DIR)
    const filename = `novelai-mask-${uuidv4()}.png`
    await fs.writeFile(path.join(INPUT_IMAGES_DIR, filename), buffer, { flag: 'wx' })
    return c.json({ success: true as const, data: { url: `${INPUT_IMAGES_API_PATH}/${filename}` } })
  })
  .post(
    '/providers/novelai/generate',
    zValidator('json', novelaiGenerateSchema),
    async (c) => {
      const input = c.req.valid('json')
      const { apiKey } = await studioProviderSettings.novelai()
      const rawItems: StudioItem[] = []
      const rawWarnings: string[] = []
      const result = await handleNovelAIImageGeneration({
        apiKey,
        baseURL: NOVELAI_IMAGE_API_BASE_URL,
        model: input.model,
        endpointName: 'NovelAI Studio',
        template: {
          id: uuidv4(),
          title: input.title || 'NovelAI Studio',
          prompt: input.prompt,
          images: input.action === 'generate' ? [] : input.referenceImageUrl ? [input.referenceImageUrl] : [],
          usageType: 'image',
          aspectRatio: `${input.width}:${input.height}`,
          n: input.n,
          createdAt: Date.now(),
        },
        advanced: input,
        studioRequest: input,
        onInpaintRawResult: async (buffer, snapshot) => {
          try {
            rawItems.push(await studioManager.fromInpaintRaw(buffer, snapshot))
          } catch {
            rawWarnings.push('上游原始结果保存失败，合成结果仍已保留')
          }
        },
      })
      if (!result.data.success) {
        if (!input.saveToTaskList && result.data.taskId) {
          await taskManager.deleteTask(result.data.taskId)
        }
        throw new Error(result.data.error)
      }
      {
        const items = []
        for (
          let index = 0;
          index < result.data.outputUrls.length;
          index += 1
        ) {
          items.push(await studioManager.fromTask(result.data.taskId, index))
        }
        if (items.length === result.data.outputUrls.length && !input.saveToTaskList) {
          // Shelf copies are durable now; removing the temporary task also removes its generated files.
          await taskManager.deleteTask(result.data.taskId)
        }
        const warning = [result.data.warning, ...new Set(rawWarnings)].filter(Boolean).join('；') || undefined
        return c.json({ success: true as const, data: { items, rawItems, warning } })
      }
    },
  )
  .get('/providers/civitai/jobs', async (c) =>
    c.json({ success: true as const, data: await civitaiGenerationManager.list() }),
  )
  .get('/providers/civitai/jobs/:id', zValidator('param', idSchema), async (c) =>
    c.json({ success: true as const, data: await civitaiGenerationManager.poll(c.req.valid('param').id) }),
  )
  .post('/providers/civitai/estimate', zValidator('json', civitaiGenerateSchema), async (c) =>
    c.json({ success: true as const, data: await civitaiGenerationManager.estimate(c.req.valid('json')) }),
  )
  .post('/providers/civitai/generate', zValidator('json', z.object({ id: z.string().uuid(), request: civitaiGenerateSchema })), async (c) => {
    const { id, request } = c.req.valid('json')
    return c.json({ success: true as const, data: await civitaiGenerationManager.submit(id, request) })
  })
  .post(
    '/providers/civitai/models',
    zValidator(
      'json',
      z.object({
        site: z.enum(['com', 'red']).default('com'),
        query: z.string().trim().max(200).optional(),
        type: z
          .enum([
            'Checkpoint',
            'LORA',
            'LoCon',
            'LyCORIS',
            'TextualInversion',
            'VAE',
            'Controlnet',
          ])
          .optional(),
        baseModel: z.string().trim().max(100).optional(),
        sort: z
          .enum(['Highest Rated', 'Most Downloaded', 'Newest'])
          .default('Highest Rated'),
        favorites: z.boolean().default(false),
        cursor: z.string().max(1000).optional(),
        limit: z.number().int().min(1).max(40).default(20),
      }),
    ),
    async (c) => {
      const { apiKey } = await studioProviderSettings.civitai()
      const input = c.req.valid('json')
      const url = new URL(`${civitaiSiteBaseUrl(input.site)}/api/v1/models`)
      url.searchParams.set('limit', String(input.limit))
      url.searchParams.set('sort', input.sort)
      url.searchParams.set('supportsGeneration', 'true')
      url.searchParams.set('primaryFileOnly', 'true')
      url.searchParams.set('nsfw', input.site === 'red' ? 'true' : 'false')
      if (input.query) url.searchParams.set('query', input.query)
      if (input.type) url.searchParams.set('types', input.type)
      if (input.baseModel) url.searchParams.set('baseModels', input.baseModel)
      if (input.favorites) url.searchParams.set('favorites', 'true')
      if (input.cursor) url.searchParams.set('cursor', input.cursor)
      const response = await fetchWithTimeout(
        url.toString(),
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
        },
        20000,
      )
      const data = await readJson(response)
      if (!response.ok)
        throw new Error(
          apiError(data, `Civitai 模型搜索失败 (${response.status})`),
        )
      const root = data as {
        items?: CivitaiApiModel[]
        metadata?: { nextCursor?: string }
      }
      const items: CivitaiModelSummary[] = (root.items || []).flatMap(
        (model) => {
          if (!model.id || !model.name) return []
          const versions = (model.modelVersions || []).flatMap((version) =>
            version.id && version.name
              ? [
                  {
                    id: version.id,
                    name: version.name,
                    baseModel: version.baseModel || '未知基础模型',
                    supportsGeneration: Boolean(version.supportsGeneration),
                    trainedWords: Array.isArray(version.trainedWords)
                      ? version.trainedWords.filter(
                          (word): word is string => typeof word === 'string',
                        )
                      : [],
                  },
                ]
              : [],
          )
          const imageUrl = (model.modelVersions || [])
            .flatMap((version) => version.images || [])
            .find((image) => image.url)?.url
          return [
            {
              id: model.id,
              name: model.name,
              type: model.type || 'Unknown',
              creator: model.creator?.username,
              imageUrl,
              nsfw: Boolean(model.nsfw),
              supportsGeneration: Boolean(model.supportsGeneration),
              versions,
            },
          ]
        },
      )
      const result: CivitaiModelSearchResult = {
        items,
        nextCursor: root.metadata?.nextCursor,
      }
      return c.json({ success: true as const, data: result })
    },
  )
  .post(
    '/from-task',
    zValidator(
      'json',
      z.object({
        taskId: z.string().uuid(),
        imageIndex: z.number().int().min(0).max(1000),
      }),
    ),
    async (c) => {
      const { taskId, imageIndex } = c.req.valid('json')
      return c.json({
        success: true as const,
        data: await studioManager.fromTask(taskId, imageIndex, true),
      })
    },
  )
  .post(
    '/items',
    bodyLimit({
      maxSize: STUDIO_MAX_FILE_BYTES + 16384,
      onError: (c) =>
        c.json({ success: false as const, error: '文件不能超过 64 MiB' }, 413),
    }),
    async (c) => {
      const form = await c.req.formData()
      const file = form.get('file')
      const documentId = form.get('documentId')
      if (!file || typeof file === 'string') throw new Error('请选择文件')
      if (
        documentId !== null &&
        (typeof documentId !== 'string' ||
          !z.string().uuid().safeParse(documentId).success)
      )
        throw new Error('无效的文档编号')
      const item = await studioManager.upload(
        Buffer.from(await file.arrayBuffer()),
        file.name,
        documentId || undefined,
      )
      return c.json({ success: true as const, data: item })
    },
  )
  .post(
    '/documents',
    zValidator(
      'json',
      z.object({
        itemId: z.string().uuid().optional(),
        external: z.boolean().optional(),
      }),
    ),
    async (c) =>
      c.json({
        success: true as const,
        data: await studioManager.document(
          c.req.valid('json').itemId,
          c.req.valid('json').external,
        ),
      }),
  )
  .post(
    '/empty',
    zValidator(
      'json',
      z.object({ ids: z.array(z.string().uuid()).max(10000) }),
    ),
    async (c) =>
      c.json({
        success: true as const,
        data: await studioManager.remove(c.req.valid('json').ids, true),
      }),
  )
  .get('/items/:id/file', zValidator('param', idSchema), async (c) => {
    const { item, buffer } = await studioManager.file(c.req.valid('param').id)
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': studioMimeType(item.format),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
  .patch(
    '/items/:id',
    zValidator('param', idSchema),
    zValidator('json', z.object({ pinned: z.boolean() })),
    async (c) =>
      c.json({
        success: true as const,
        data: await studioManager.pin(
          c.req.valid('param').id,
          c.req.valid('json').pinned,
        ),
      }),
  )
  .delete('/items/:id', zValidator('param', idSchema), async (c) =>
    c.json({
      success: true as const,
      data: await studioManager.remove([c.req.valid('param').id], false),
    }),
  )
  .post('/items/:id/archive', zValidator('param', idSchema), async (c) =>
    c.json({
      success: true as const,
      data: await studioManager.archive(c.req.valid('param').id),
    }),
  )
  .post('/items/:id/reference', zValidator('param', idSchema), async (c) =>
    c.json({
      success: true as const,
      data: await studioManager.reference(c.req.valid('param').id),
    }),
  )

export default studioApi
