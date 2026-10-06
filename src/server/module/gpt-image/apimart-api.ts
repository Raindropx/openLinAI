import type { GptImageQuality, GptImageSize } from './enum'

type JsonObject = Record<string, any>

class APIMartError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message)
  }
}

async function requestJson(
  url: string,
  apiKey: string,
  body?: JsonObject,
  timeoutMs = 30000,
): Promise<JsonObject> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || (data?.code !== undefined && data.code !== 200)) {
      throw new APIMartError(
        data?.error?.message ||
          data?.message ||
          `APImart 返回 ${response.status}`,
        response.ok ? Number(data?.code) || 500 : response.status,
      )
    }
    if (!data || typeof data !== 'object') {
      throw new APIMartError('APImart 返回了无法解析的响应')
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

const GPT2_RATIOS = [
  'auto',
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '2:1',
  '1:2',
  '3:1',
  '1:3',
  '21:9',
  '9:21',
]
const NANO2_RATIOS = [
  'auto',
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '5:4',
  '4:5',
  '21:9',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
]

/** Explicit contracts for the two presets; other models use the provider schema. */
export async function buildAPIMartImageBody(options: {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  aspectRatio: string
  size: GptImageSize
  quality: GptImageQuality
  images: string[]
}) {
  const { model, aspectRatio, size, images } = options
  let properties: JsonObject
  if (/^gpt-image-2(?:-ext|-official)?$/i.test(model)) {
    properties = {
      size: { enum: GPT2_RATIOS },
      resolution: { enum: ['1k', '2k', '4k'] },
      image_urls: { maxItems: 15 },
    }
  } else if (
    /^(gemini-3\.1-flash-image-preview(?:-official)?|nano-banana-2(?:-ext)?)$/i.test(
      model,
    )
  ) {
    properties = {
      size: { enum: NANO2_RATIOS },
      resolution: { enum: ['1K', '2K', '4K'] },
      image_urls: { maxItems: 14 },
    }
  } else {
    const catalog = await requestJson(
      `${options.baseURL.replace(/\/+$/, '')}/models?expand=parameters&category=image`,
      options.apiKey,
    )
    const record = Array.isArray(catalog.data)
      ? catalog.data.find((item: JsonObject) => item.id === model)
      : undefined
    const contract = record?.parameters
    if (
      contract?.operation !== 'image_generation' ||
      contract.method !== 'POST' ||
      contract.endpoint !== '/v1/images/generations'
    ) {
      throw new Error(`APImart 模型 ${model} 未声明兼容的图片生成接口`)
    }
    properties = contract.input_schema?.properties
    if (!properties?.prompt || !properties?.size) {
      throw new Error(
        `APImart 未提供模型 ${model} 的图片参数定义，请使用 GPT Image 2 或 Nano Banana 2 预设`,
      )
    }
  }
  if (
    Array.isArray(properties.size?.enum) &&
    !properties.size.enum.includes(aspectRatio)
  ) {
    throw new Error(
      `APImart 模型 ${model} 不支持比例 ${aspectRatio}；可选：${properties.size.enum.join('、')}`,
    )
  }
  if (images.length && !properties.image_urls) {
    throw new Error(`APImart 模型 ${model} 未声明参考图输入能力`)
  }
  if (images.length > (properties.image_urls?.maxItems ?? 15)) {
    throw new Error(
      `APImart 模型 ${model} 最多接受 ${properties.image_urls?.maxItems ?? 15} 张参考图`,
    )
  }
  if (/^gpt-image-1(?:\.5)?-official$/i.test(model) && images.length) {
    throw new Error(
      'APImart GPT Image 1/1.5 需要公开参考图 URL；请改用 GPT Image 2 或 Nano Banana 2 预设',
    )
  }
  const body: JsonObject = {
    model,
    prompt: options.prompt,
    size: aspectRatio,
    n: 1,
    ...(images.length ? { image_urls: images } : {}),
  }
  if (properties.resolution) {
    const values = properties.resolution.enum
    const resolution = Array.isArray(values)
      ? values.find(
          (value: unknown) =>
            typeof value === 'string' && value.toLowerCase() === size,
        )
      : size
    if (!resolution)
      throw new Error(`APImart 模型 ${model} 不支持 ${size} 分辨率`)
    body.resolution = resolution
  } else if (size !== '1k') {
    throw new Error(`APImart 模型 ${model} 未声明 ${size} 分辨率支持`)
  }
  if (properties.quality) {
    const values = properties.quality.enum
    if (Array.isArray(values) && !values.includes(options.quality)) {
      throw new Error(`APImart 模型 ${model} 不支持 ${options.quality} 画质`)
    }
    body.quality = options.quality
  }
  return body
}

/** Submission is never retried. Only read-only polling retries transient failures. */
export async function generateAPIMartImage(options: {
  apiKey: string
  baseURL: string
  body: JsonObject
  onSubmitted: (id: string) => Promise<void>
  timeoutMs?: number
  pollIntervalMs?: number
}) {
  const baseURL = options.baseURL.trim().replace(/\/+$/, '')
  const submitted = await requestJson(
    `${baseURL}/images/generations`,
    options.apiKey,
    options.body,
    120000,
  )
  const taskId = submitted.data?.[0]?.task_id
  if (typeof taskId !== 'string' || !taskId)
    throw new Error('APImart 未返回任务 ID')
  await options.onSubmitted(taskId)
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60 * 1000)
  let consecutiveFailures = 0
  while (Date.now() < deadline) {
    let response: JsonObject
    try {
      response = await requestJson(
        `${baseURL}/tasks/${encodeURIComponent(taskId)}`,
        options.apiKey,
        undefined,
        Math.min(30000, deadline - Date.now()),
      )
      consecutiveFailures = 0
    } catch (error) {
      if (
        !(error instanceof APIMartError) ||
        (error.status !== 429 && error.status < 500) ||
        ++consecutiveFailures > 3
      ) {
        throw new Error(
          `APImart 任务 ${taskId} 查询失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(
            options.pollIntervalMs ?? 3000,
            Math.max(0, deadline - Date.now()),
          ),
        ),
      )
      continue
    }
    const task = response.data
    if (task?.status === 'completed') {
      const urls = Array.isArray(task.result?.images)
        ? task.result.images
            .flatMap((image: JsonObject) =>
              Array.isArray(image.url) ? image.url : [image.url],
            )
            .filter(
              (url: unknown): url is string =>
                typeof url === 'string' && /^https?:\/\//.test(url),
            )
        : []
      if (!urls.length)
        throw new Error(`APImart 任务 ${taskId} 完成但未返回图片`)
      const cost =
        typeof task.cost === 'number' &&
        Number.isFinite(task.cost) &&
        task.cost >= 0
          ? task.cost
          : undefined
      return { taskId, urls: urls as string[], cost }
    }
    if (task?.status === 'failed' || task?.status === 'cancelled') {
      throw new Error(
        `APImart 任务 ${taskId}：${task.error?.message || '生成失败'}`,
      )
    }
    if (
      !['submitted', 'pending', 'processing', 'running', 'queued'].includes(
        task?.status,
      )
    ) {
      throw new Error(
        `APImart 任务 ${taskId} 返回未知状态：${String(task?.status)}`,
      )
    }
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(
          options.pollIntervalMs ?? 3000,
          Math.max(0, deadline - Date.now()),
        ),
      ),
    )
  }
  throw new Error(
    `APImart 任务 ${taskId} 查询超时；上游可能仍在生成，请先在控制台查看该任务再决定是否重新生成`,
  )
}
