import fs from 'fs-extra'
import { randomInt } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import {
  CIVITAI_SAMPLERS,
  CIVITAI_SCHEDULES,
  civitaiEcosystem,
  civitaiJobFinished,
  civitaiSiteBaseUrl,
  type CivitaiGenerateRequest,
  type CivitaiResource,
  type CivitaiStudioJob,
} from '../../shared/civitai-generation'
import { STUDIO_MAX_FILE_BYTES } from '../../shared/studio'
import { getDataDir } from '../common/data-dir'
import { SafeJsonStore } from '../common/safe-json-store'
import { resizeImageToExactDimensions } from '../common/static/imageProcessor'
import { studioManager } from '../common/studio-manager'
import { studioProviderSettings } from '../common/studio-provider-settings'
import { fetchWithTimeout } from './utils/fetch'

const API = 'https://orchestration.civitai.com/v2/consumer'
const resourceSchema = z.object({
  modelId: z.number().int().positive(),
  versionId: z.number().int().positive(),
  name: z.string().max(300),
  baseModel: z.string().max(100),
  type: z.enum(['Checkpoint', 'LORA', 'LoCon']),
})
const dimension = z.number().int().min(64).max(2048).multipleOf(64)
export const civitaiGenerateSchema = z
  .object({
    site: z.enum(['com', 'red']).default('com'),
    model: resourceSchema,
    loras: z
      .array(resourceSchema.extend({ strength: z.number().min(-2).max(2) }))
      .max(10)
      .default([]),
    prompt: z.string().trim().min(1, '提示词不能为空').max(10000),
    negativePrompt: z.string().max(10000).default(''),
    width: dimension,
    height: dimension,
    steps: z.number().int().min(1).max(150),
    scale: z.number().min(0).max(30),
    sampler: z.enum(CIVITAI_SAMPLERS),
    schedule: z.enum(CIVITAI_SCHEDULES),
    seed: z.number().int().min(-1).max(0x7fffffff),
    n: z.number().int().min(1).max(4),
    clipSkip: z.number().int().min(1).max(12).default(2),
    referenceItemId: z.string().uuid().optional(),
    strength: z.number().min(0).max(1).default(0.7),
    allowMatureContent: z.boolean().default(false),
    saveToTaskList: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    if (
      input.model.type !== 'Checkpoint' ||
      !civitaiEcosystem(input.model.baseModel)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: '请选择支持的 SD 1.x 或 SDXL Checkpoint',
      })
    const versions = new Set<number>()
    for (const lora of input.loras) {
      if (
        lora.type === 'Checkpoint' ||
        lora.baseModel !== input.model.baseModel
      )
        ctx.addIssue({
          code: 'custom',
          path: ['loras'],
          message: 'LoRA 必须与主模型的基础模型一致',
        })
      if (versions.has(lora.versionId))
        ctx.addIssue({
          code: 'custom',
          path: ['loras'],
          message: '不能重复挂载同一 LoRA 版本',
        })
      versions.add(lora.versionId)
    }
  })

interface Workflow {
  id: string
  status: CivitaiStudioJob['status']
  cost?: { total?: number }
  steps?: Array<{
    name: string
    status?: string
    estimatedProgressRate?: number
    warnings?: Array<{ message?: string }>
    jobs?: Array<{ reason?: string; blockedReason?: string }>
    output?: {
      images?: Array<{
        id: string
        url?: string
        available?: boolean
        blockedReason?: string
      }>
      errors?: string[]
    }
  }>
}
interface StoredJob extends CivitaiStudioJob {
  request: CivitaiGenerateRequest
  /** Persist before submission; never automatically submit this job twice. */
  seeds: number[]
  saved: Record<string, string>
}
function validateWorkflow(workflow: Workflow) {
  if (
    !workflow.id ||
    ![
      'unassigned',
      'preparing',
      'scheduled',
      'processing',
      'succeeded',
      'failed',
      'expired',
      'canceled',
    ].includes(workflow.status)
  )
    throw new Error('Civitai 返回了无效的工作流状态，请继续查询确认提交结果')
  return workflow
}
class CivitaiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Civitai 请求失败'

const resourceAir = (resource: CivitaiResource) =>
  `urn:air:${civitaiEcosystem(resource.baseModel)}:${resource.type === 'Checkpoint' ? 'checkpoint' : resource.type === 'LoCon' ? 'locon' : 'lora'}:civitai:${resource.modelId}@${resource.versionId}`

async function requestJson<T>(
  url: string,
  apiKey: string,
  body?: unknown,
): Promise<T> {
  const response = await fetchWithTimeout(
    url,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    },
    45000,
  )
  const data = await response.json().catch(() => undefined)
  if (!response.ok) {
    const detail = [data?.detail, data?.message, data?.error, data?.title].find(
      (value) => typeof value === 'string',
    )
    throw new CivitaiHttpError(
      `Civitai (${response.status})：${detail ? detail.split(apiKey).join('[已隐藏]').slice(0, 600) : '请求失败，请检查 Key、余额与模型权限'}`,
      response.status,
    )
  }
  if (!data || typeof data !== 'object')
    throw new Error('Civitai 返回了无效响应')
  return data as T
}

async function verifyResources(input: CivitaiGenerateRequest, apiKey: string) {
  const verify = async (
    resource: CivitaiResource,
  ): Promise<CivitaiResource> => {
    const version = await requestJson<{
      air?: string
      modelName?: string
      versionName?: string
      baseModel: string
      canGenerate?: boolean
    }>(
      `${civitaiSiteBaseUrl(input.site || 'com')}/api/v1/model-versions/mini/${resource.versionId}`,
      apiKey,
    )
    if (
      version.air !== resourceAir(resource) ||
      version.baseModel !== resource.baseModel ||
      version.canGenerate !== true
    )
      throw new Error(
        `模型版本 ${resource.versionId} 不可在线生成或资料已变更，请重新搜索选择`,
      )
    return {
      ...resource,
      name: `${version.modelName || resource.name} · ${version.versionName || resource.versionId}`.slice(0, 300),
    }
  }
  const model = await verify(input.model)
  const loras = []
  for (const lora of input.loras)
    loras.push({ ...(await verify(lora)), strength: lora.strength })
  return { ...input, model, loras }
}

export function buildCivitaiWorkflow(
  input: CivitaiGenerateRequest,
  seeds: number[],
  image?: string,
  tag?: string,
) {
  const ecosystem = civitaiEcosystem(input.model.baseModel)
  return {
    ...(tag ? { tags: [tag] } : {}),
    allowMatureContent: input.allowMatureContent,
    steps: seeds.map((seed, index) => ({
      $type: 'imageGen',
      name: `image-${index}`,
      timeout: '00:10:00',
      input: {
        engine: 'sdcpp',
        ecosystem,
        operation: image ? 'createVariant' : 'createImage',
        model: resourceAir(input.model),
        loras: Object.fromEntries(
          input.loras.map((lora) => [resourceAir(lora), lora.strength]),
        ),
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        width: input.width,
        height: input.height,
        steps: input.steps,
        cfgScale: input.scale,
        sampleMethod: input.sampler,
        schedule: input.schedule,
        seed,
        quantity: 1,
        ...(ecosystem === 'sd1' ? { clipSkip: input.clipSkip } : {}),
        ...(image ? { image, strength: input.strength } : {}),
      },
    })),
  }
}

async function referenceImage(input: CivitaiGenerateRequest) {
  if (!input.referenceItemId) return undefined
  const { item, buffer } = await studioManager.file(input.referenceItemId)
  if (item.format === 'psd') throw new Error('请先将 PSD 保存为图片')
  // imageProcessor selects FFmpeg on OpenWrt, where the optional Sharp
  // native module is intentionally absent. The Civitai API accepts JPEG data
  // URLs, so the router path stays self-contained while desktop keeps PNG.
  const resized = await resizeImageToExactDimensions(
    buffer,
    input.width,
    input.height,
  )
  const mime = process.env.IMAGE_BACKEND === 'ffmpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,${resized.toString('base64')}`
}

async function downloadImage(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new Error('Civitai 图片地址无效')
  // The URL comes exclusively from the authenticated workflow, never from the client.
  // Signed result URLs do not need (and must not receive) the provider API key.
  const response = await fetchWithTimeout(
    url,
    { signal: AbortSignal.timeout(60000) },
    60000,
  )
  if (!response.ok || !response.body)
    throw new Error(`结果下载失败 (${response.status})，可继续查询重试保存`)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > STUDIO_MAX_FILE_BYTES)
        throw new Error('Civitai 结果超过 64 MiB')
      chunks.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  // Civitai returns PNG/JPEG/WebP results. Keep the original encoded bytes;
  // StudioManager validates the format and OpenWrt must not load Sharp just
  // to normalize an image that is already a supported shelf format.
  return Buffer.concat(chunks)
}

export class CivitaiGenerationManager {
  private root = path.join(getDataDir(), 'studio', 'civitai-jobs')
  private queues = new Map<string, Promise<unknown>>()
  private store(id: string) {
    z.string().uuid().parse(id)
    return new SafeJsonStore<StoredJob>(path.join(this.root, `${id}.json`))
  }
  private run<T>(id: string, action: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) || Promise.resolve())
      .catch(() => {})
      .then(action)
    this.queues.set(id, next)
    void next
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id)
      })
      .catch(() => {})
    return next
  }
  private view(job: StoredJob): CivitaiStudioJob {
    const { request: _request, seeds: _seeds, saved: _saved, ...view } = job
    return view
  }
  async list() {
    await fs.ensureDir(this.root)
    const files = (await fs.readdir(this.root)).filter((file) =>
      /^[\da-f-]{36}\.json$/i.test(file),
    )
    const jobs = await Promise.all(
      files.map((file) => this.store(file.slice(0, -5)).read()),
    )
    return jobs
      .filter((job): job is StoredJob => !!job)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((job) => this.view(job))
  }
  async estimate(raw: CivitaiGenerateRequest) {
    const { apiKey } = await studioProviderSettings.civitai()
    const input = await verifyResources(
      civitaiGenerateSchema.parse(raw),
      apiKey,
    )
    const image = await referenceImage(input)
    const workflow = await requestJson<Workflow>(
      `${API}/workflows?whatif=true&wait=0`,
      apiKey,
      buildCivitaiWorkflow(
        input,
        Array.from(
          { length: input.n },
          (_, index) => (Math.max(0, input.seed) + index) % 0x80000000,
        ),
        image,
      ),
    )
    const cost = workflow.cost?.total
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)
      throw new Error('Civitai 未返回可用的 Buzz 预估')
    return { cost }
  }
  submit(id: string, raw: CivitaiGenerateRequest) {
    return this.run(id, async () => {
      const store = this.store(id)
      const existing = await store.read()
      if (existing) return this.view(existing)
      if (await fs.pathExists(path.join(this.root, `${id}.json`)))
        throw new Error('生成记录损坏，已停止提交以避免重复扣费')
      const { apiKey } = await studioProviderSettings.civitai()
      const input = await verifyResources(
        civitaiGenerateSchema.parse(raw),
        apiKey,
      )
      const image = await referenceImage(input)
      const seed = input.seed < 0 ? randomInt(0x80000000) : input.seed
      const job: StoredJob = {
        id,
        request: input,
        seeds: Array.from(
          { length: input.n },
          (_, index) => (seed + index) % 0x80000000,
        ),
        createdAt: Date.now(),
        status: 'submitting',
        items: [],
        saved: {},
        settled: false,
      }
      await fs.ensureDir(this.root)
      await store.write(job)
      try {
        const workflow = await requestJson<Workflow>(
          `${API}/workflows?wait=0`,
          apiKey,
          buildCivitaiWorkflow(input, job.seeds, image, `openlinai-${id}`),
        )
        validateWorkflow(workflow)
        job.workflowId = workflow.id
        job.status = workflow.status
        job.cost = workflow.cost?.total
      } catch (error) {
        job.status =
          error instanceof CivitaiHttpError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408
            ? 'failed'
            : 'unknown'
        job.settled = job.status === 'failed'
        job.error = `${errorMessage(error)}${job.status === 'unknown' ? '；提交结果不确定，请继续查询，避免重复生成扣费' : ''}`
      }
      await store.write(job)
      return this.view(job)
    })
  }
  poll(id: string) {
    return this.run(id, async () => {
      const store = this.store(id)
      const job = await store.read()
      if (!job) throw new Error('生成记录不存在')
      if (job.settled) return this.view(job)
      const { apiKey } = await studioProviderSettings.civitai()
      let workflow: Workflow
      if (job.workflowId)
        workflow = await requestJson<Workflow>(
          `${API}/workflows/${encodeURIComponent(job.workflowId)}?wait=0`,
          apiKey,
        )
      else {
        const found = await requestJson<{ items: Workflow[] }>(
          `${API}/workflows?tags=${encodeURIComponent(`openlinai-${id}`)}&take=1&hideMatureContent=false`,
          apiKey,
        )
        if (!found.items?.[0]) {
          job.status = 'unknown'
          job.error =
            '暂未查询到工作流；请稍后继续查询或在 Civitai 核对生成记录，确认后再新建生成，以免重复扣费。'
          await store.write(job)
          return this.view(job)
        }
        workflow = found.items[0]
        job.workflowId = workflow.id
      }
      validateWorkflow(workflow)
      job.status = workflow.status
      job.cost = workflow.cost?.total ?? job.cost
      job.error = undefined
      const steps = workflow.steps || []
      job.progress = steps.length
        ? Math.round(
            (100 *
              steps.reduce(
                (sum, step) =>
                  sum +
                  (step.status === 'succeeded'
                    ? 1
                    : Math.max(
                        0,
                        Math.min(1, step.estimatedProgressRate || 0),
                      )),
                0,
              )) /
              steps.length,
          )
        : undefined
      const warnings = steps.flatMap((step) =>
        (step.warnings || []).map((warning) => warning.message).filter(Boolean),
      )
      const failures = steps.flatMap((step) => [
        ...(step.output?.errors || []),
        ...(step.jobs || []).flatMap((upstreamJob) =>
          [upstreamJob.blockedReason, upstreamJob.reason].filter(Boolean),
        ),
      ])
      if (civitaiJobFinished(job.status)) {
        try {
          for (let index = 0; index < job.seeds.length; index++) {
            const step = steps.find((entry) => entry.name === `image-${index}`)
            const images = step?.output?.images || []
            for (const blob of images) {
              if (job.saved[blob.id]) continue
              if (!blob.url || blob.available === false) {
                warnings.push(
                  blob.blockedReason ||
                    '部分图片不可下载，请在 Civitai 检查结果',
                )
                continue
              }
              const buffer = await downloadImage(blob.url)
              const item = await studioManager.fromCivitai(buffer, {
                version: 1,
                request: { ...job.request, seed: job.seeds[index], n: 1 },
                workflowId: job.workflowId!,
                imageIndex: index,
                seed: job.seeds[index],
              })
              job.saved[blob.id] = item.id
              job.items.push(item)
              await store.write(job)
            }
          }
          if (job.request.saveToTaskList) {
            for (const item of job.items) {
              const archived = await studioManager.archive(item.id)
              item.archivedTaskId = archived.taskId
            }
          }
          job.settled = true
          if (job.status !== 'succeeded')
            job.error =
              failures.join('；').slice(0, 1000) ||
              `Civitai 工作流${job.status === 'expired' ? '超时' : job.status === 'canceled' ? '已取消' : '失败'}`
          if (job.items.length < job.seeds.length)
            warnings.push(
              `已保存 ${job.items.length}/${job.seeds.length} 张图片`,
            )
        } catch (error) {
          job.error = `生成结果保存未完成：${errorMessage(error)}。继续查询可重试保存，不会重新生成。`
        }
      }
      job.warning =
        [
          ...new Set([
            ...warnings,
            ...(job.status === 'succeeded' ? failures : []),
          ]),
        ]
          .join('；')
          .slice(0, 1000) || undefined
      await store.write(job)
      return this.view(job)
    })
  }
}

export const civitaiGenerationManager = new CivitaiGenerationManager()
