import crypto from 'crypto'
import type { SpicyLora } from '../../../shared/spicyapi'
import { spicyBaseURL } from '../../../shared/spicyapi'
import { fetchWithTimeout } from '../utils/fetch'

type JsonObject = Record<string, any>

class SpicyAPIError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message)
  }
}

export async function spicyRequest(
  baseURL: string,
  apiKey: string,
  apiPath: string,
  body?: JsonObject,
  options: {
    method?: string
    idempotencyKey?: string
    timeoutMs?: number
  } = {},
): Promise<JsonObject> {
  const response = await fetchWithTimeout(
    `${spicyBaseURL(baseURL)}${apiPath}`,
    {
      method: options.method || (body ? 'POST' : 'GET'),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.idempotencyKey
          ? { 'Idempotency-Key': options.idempotencyKey }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    options.timeoutMs ?? 30000,
  )
  const json = (await response.json().catch(() => null)) as JsonObject | null
  if (!response.ok || json?.code !== 200) {
    throw new SpicyAPIError(
      json?.msg || json?.error?.message || `SpicyAPI 返回 ${response.status}`,
      response.ok ? 400 : response.status,
    )
  }
  return json
}

const schemaCache = new Map<string, { expiresAt: number; record: JsonObject }>()

export async function getSpicyModel(
  baseURL: string,
  apiKey: string,
  model: string,
) {
  const key = `${spicyBaseURL(baseURL)}:${crypto.createHash('sha256').update(apiKey).digest('hex')}:${model}`
  const cached = schemaCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.record
  const response = await spicyRequest(
    baseURL,
    apiKey,
    `/models/${model.split('/').map(encodeURIComponent).join('/')}`,
  )
  const record = response.data
  if (!record?.enabled || !record?.available || record.modality !== 'image')
    throw new Error(`SpicyAPI 模型 ${model} 当前不可用于图片生成`)
  if (!record.inputSchema?.properties)
    throw new Error(`SpicyAPI 未返回模型 ${model} 的参数定义`)
  schemaCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, record })
  return record
}

/** Validate before uploading files or submitting a billable task. */
export function buildSpicyImageBody(options: {
  model: string
  record: JsonObject
  prompt: string
  aspectRatio: string
  resolution: string
  images: string[]
  loras?: SpicyLora[]
  seed?: number
}) {
  const { model, record, images } = options
  const properties = record.inputSchema.properties
  const input: JsonObject = { prompt: options.prompt }
  const task = images.length ? 'image-to-image' : 'text-to-image'
  if (!Array.isArray(record.tasks) || !record.tasks.includes(task))
    throw new Error(`SpicyAPI 模型 ${model} 不支持 ${task}`)
  if (properties.aspect_ratio) input.aspect_ratio = options.aspectRatio
  else if (options.aspectRatio !== '1:1')
    throw new Error(`SpicyAPI 模型 ${model} 不支持比例设置`)
  if (properties.resolution) input.resolution = options.resolution
  else if (options.resolution !== '1k')
    throw new Error(`SpicyAPI 模型 ${model} 不支持分辨率设置`)
  if (properties.output_format?.enum?.includes('png'))
    input.output_format = 'png'
  if (images.length) {
    if (properties.image_urls) input.image_urls = images
    else if (properties.image_url) {
      if (images.length !== 1)
        throw new Error(`SpicyAPI 模型 ${model} 只接受 1 张参考图`)
      input.image_url = images[0]
    } else throw new Error(`SpicyAPI 模型 ${model} 未声明兼容的参考图参数`)
  }
  if (options.loras?.length) input.loras = options.loras
  if (options.seed !== undefined) input.seed = options.seed
  for (const required of record.inputSchema.required || []) {
    if (input[required] === undefined)
      throw new Error(
        `SpicyAPI 模型 ${model} 需要参数 ${required}，请使用兼容的图片模型`,
      )
  }
  for (const [key, value] of Object.entries(input)) {
    const spec = properties[key]
    if (!spec) throw new Error(`SpicyAPI 模型 ${model} 不支持参数 ${key}`)
    if (spec.enum && !spec.enum.includes(value))
      throw new Error(
        `SpicyAPI 模型 ${model} 不支持 ${key}=${value}；可选：${spec.enum.join('、')}`,
      )
    if (
      typeof value === 'string' &&
      ((spec.minLength !== undefined && value.length < spec.minLength) ||
        (spec.maxLength !== undefined && value.length > spec.maxLength))
    )
      throw new Error(
        `SpicyAPI 参数 ${key} 长度应在 ${spec.minLength ?? 0} 到 ${spec.maxLength ?? '不限'} 之间`,
      )
    if (
      Array.isArray(value) &&
      ((spec.minItems !== undefined && value.length < spec.minItems) ||
        (spec.maxItems !== undefined && value.length > spec.maxItems))
    )
      throw new Error(
        `SpicyAPI 参数 ${key} 数量应在 ${spec.minItems ?? 0} 到 ${spec.maxItems ?? '不限'} 之间`,
      )
    if (
      typeof value === 'number' &&
      ((spec.minimum !== undefined && value < spec.minimum) ||
        (spec.maximum !== undefined && value > spec.maximum))
    )
      throw new Error(`SpicyAPI 参数 ${key} 超出当前模型允许的范围`)
  }
  if (
    options.seed !== undefined &&
    (!Number.isInteger(options.seed) ||
      options.seed < 0 ||
      options.seed > 2147483647)
  )
    throw new Error('SpicyAPI Seed 必须是 0–2147483647 的整数')
  for (const lora of options.loras || []) {
    if (
      !/^https?:\/\//i.test(lora.path) ||
      !Number.isFinite(lora.scale) ||
      lora.scale < 0 ||
      lora.scale > 4
    )
      throw new Error('SpicyAPI LoRA 需要有效的 HTTP(S) 地址和 0–4 的权重')
    const scale = properties.loras?.items?.properties?.scale
    if (
      scale &&
      ((scale.minimum !== undefined && lora.scale < scale.minimum) ||
        (scale.maximum !== undefined && lora.scale > scale.maximum))
    )
      throw new Error(
        `SpicyAPI 当前模型的 LoRA 权重必须在 ${scale.minimum ?? 0} 到 ${scale.maximum ?? 4} 之间`,
      )
    const fields = properties.loras?.items?.properties || {}
    if (
      !fields.path ||
      !fields.scale ||
      (properties.loras?.items?.required || []).some(
        (key: string) => !['path', 'scale'].includes(key),
      )
    )
      throw new Error('SpicyAPI 当前模型的 LoRA 参数格式不受支持')
  }
  return { model, input }
}

export async function uploadSpicyImage(options: {
  baseURL: string
  apiKey: string
  bytes: Buffer
  contentType: string
  maxBytes?: number
}) {
  const { baseURL, apiKey, bytes, contentType } = options
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
      contentType,
    )
  )
    throw new Error('SpicyAPI 参考图只支持 JPEG、PNG、WebP、GIF')
  if (
    !bytes.length ||
    bytes.length > Math.min(options.maxBytes ?? Infinity, 10 * 1024 * 1024)
  )
    throw new Error('SpicyAPI 参考图超过上传或模型大小限制（最大 10 MiB）')
  const ticket = (
    await spicyRequest(baseURL, apiKey, '/common/upload-url', {
      contentType,
      bytes: bytes.length,
    })
  ).data
  if (
    !ticket?.fileId ||
    !/^https?:\/\//.test(ticket.uploadUrl || '') ||
    ticket.method !== 'PUT'
  )
    throw new Error('SpicyAPI 未返回有效的上传凭据')
  if (bytes.length > ticket.maxBytes)
    throw new Error('SpicyAPI 参考图超过上传凭据的大小限制')
  // Storage uses the signed ticket headers, never the API bearer token.
  const uploaded = await fetchWithTimeout(
    ticket.uploadUrl,
    {
      method: 'PUT',
      headers: ticket.headers,
      body: new Uint8Array(bytes),
    },
    120000,
  )
  if (!uploaded.ok)
    throw new Error(`SpicyAPI 参考图上传失败 (${uploaded.status})`)
  let file: JsonObject | undefined
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      file = (
        await spicyRequest(
          baseURL,
          apiKey,
          `/files/${encodeURIComponent(ticket.fileId)}/commit`,
          undefined,
          { method: 'POST' },
        )
      ).data
      break
    } catch (error) {
      if (
        !(error instanceof SpicyAPIError) ||
        ![409, 429].includes(error.status) ||
        attempt === 3
      )
        throw error
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  if (file?.status !== 'ready' || !file.uri?.startsWith('spicy://'))
    throw new Error('SpicyAPI 参考图未完成上传验证')
  return file.uri as string
}

export async function generateSpicyImage(options: {
  baseURL: string
  apiKey: string
  body: JsonObject
  onPrepared: (key: string) => Promise<void>
  onSubmitted: (id: string) => Promise<void>
  timeoutMs?: number
  pollIntervalMs?: number
}) {
  const idempotencyKey = crypto.randomUUID()
  await options.onPrepared(idempotencyKey)
  // Never automatically repeat a billable submission after an uncertain response.
  let submitted: JsonObject
  try {
    submitted = await spicyRequest(
      options.baseURL,
      options.apiKey,
      '/jobs/createTask',
      options.body,
      { idempotencyKey },
    )
  } catch (error) {
    throw new Error(
      `SpicyAPI 提交失败（幂等键 ${idempotencyKey}）：${error instanceof Error ? error.message : String(error)}；若网络中断，请先查看控制台任务再重新生成`,
    )
  }
  const taskId = submitted.data?.taskId
  if (typeof taskId !== 'string' || !taskId)
    throw new Error(`SpicyAPI 未返回任务 ID（幂等键 ${idempotencyKey}）`)
  await options.onSubmitted(taskId)
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60 * 1000)
  let failures = 0
  let polls = 0
  while (Date.now() < deadline) {
    try {
      const task = (
        await spicyRequest(
          options.baseURL,
          options.apiKey,
          `/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
          undefined,
          {
            timeoutMs: Math.min(30000, Math.max(1, deadline - Date.now())),
          },
        )
      ).data
      failures = 0
      if (task?.state === 'succeeded') {
        const urls = Array.isArray(task.output?.assets)
          ? task.output.assets
              .filter(
                (asset: JsonObject) =>
                  typeof asset.url === 'string' &&
                  /^https?:\/\//.test(asset.url) &&
                  (typeof asset.mime !== 'string' ||
                    asset.mime.startsWith('image/')),
              )
              .map((asset: JsonObject) => asset.url as string)
          : []
        if (!urls.length) throw new Error('任务完成但未返回可下载的图片')
        const cost =
          typeof task.cost === 'number' ||
          (typeof task.cost === 'string' && task.cost.trim())
            ? Number(task.cost)
            : Number.NaN
        return {
          taskId,
          urls: urls as string[],
          cost:
            task.settled === true && Number.isFinite(cost) && cost >= 0
              ? cost
              : undefined,
        }
      }
      if (['failed', 'expired', 'canceled'].includes(task?.state))
        throw new Error(
          `${task.errorCode || task.state}：${task.errorMessage || '生成失败'}`,
        )
      if (!['queued', 'running'].includes(task?.state))
        throw new Error(`未知任务状态：${String(task?.state)}`)
    } catch (error) {
      const retryable =
        error instanceof SpicyAPIError
          ? error.status === 429 || error.status >= 500
          : error instanceof TypeError ||
            (error instanceof Error && error.name === 'AbortError')
      if (!retryable || ++failures > 3)
        throw new Error(
          `SpicyAPI 任务 ${taskId}：${error instanceof Error ? error.message : String(error)}`,
        )
    }
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(
          options.pollIntervalMs ?? Math.min(10000, 2000 * 1.3 ** polls++),
          Math.max(0, deadline - Date.now()),
        ),
      ),
    )
  }
  throw new Error(
    `SpicyAPI 任务 ${taskId} 查询超时；上游可能仍在生成，请先在控制台查看该任务再重新生成`,
  )
}
