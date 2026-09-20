import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { STUDIO_MAX_FILE_BYTES } from '../../shared/studio'
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
import { INPUT_IMAGES_API_PATH } from '../common/static/enum'
import { handleNovelAIImageGeneration } from '../module/gpt-image/novelai-image'
import { fetchWithTimeout } from '../module/utils/fetch'

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
  referenceImageUrl: inputImageUrlSchema.optional(),
  strength: z.number().min(0).max(1).default(0.7),
  noise: z.number().min(0).max(1).default(0.1),
  saveToTaskList: z.boolean().default(false),
  characters: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(10000),
        negativePrompt: z.string().max(10000).default(''),
      }),
    )
    .max(22),
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
    return c.json({ success: true as const, data: { connected: true } })
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
  .post(
    '/providers/novelai/generate',
    zValidator('json', novelaiGenerateSchema),
    async (c) => {
      const input = c.req.valid('json')
      const { apiKey } = await studioProviderSettings.novelai()
      const result = await handleNovelAIImageGeneration({
        apiKey,
        baseURL: NOVELAI_IMAGE_API_BASE_URL,
        model: input.model,
        endpointName: 'NovelAI Studio',
        template: {
          id: uuidv4(),
          title: input.title || 'NovelAI Studio',
          prompt: input.prompt,
          images: input.referenceImageUrl ? [input.referenceImageUrl] : [],
          usageType: 'image',
          aspectRatio: `${input.width}:${input.height}`,
          n: input.n,
          createdAt: Date.now(),
        },
        advanced: input,
      })
      if (!result.data.success) {
        if (!input.saveToTaskList && result.data.taskId) {
          await taskManager.deleteTask(result.data.taskId)
        }
        throw new Error(result.data.error)
      }
      try {
        const items = []
        for (
          let index = 0;
          index < result.data.outputUrls.length;
          index += 1
        ) {
          items.push(await studioManager.fromTask(result.data.taskId, index))
        }
        return c.json({ success: true as const, data: { items } })
      } finally {
        if (!input.saveToTaskList) {
          await taskManager.deleteTask(result.data.taskId)
        }
      }
    },
  )
  .post(
    '/providers/civitai/models',
    zValidator(
      'json',
      z.object({
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
      const url = new URL('https://civitai.com/api/v1/models')
      url.searchParams.set('limit', String(input.limit))
      url.searchParams.set('sort', input.sort)
      url.searchParams.set('supportsGeneration', 'true')
      url.searchParams.set('primaryFileOnly', 'true')
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
        data: await studioManager.fromTask(taskId, imageIndex),
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
