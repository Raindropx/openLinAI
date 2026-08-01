import fs from 'fs-extra'
import path from 'path'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { taskManager } from '../../common/task-manager'
import { TaskTemplate } from '../../common/template-manager'
import { fetchWithTimeout } from '../utils/fetch'
import { logger } from '../utils/logger'
import { GptImageQuality, GptImageSize } from './enum'
import { persistImages, readImageAsDataUrl } from './image-files'
import { buildPromptWithAspectRatio } from './index'

interface CapabilityDescriptor {
  type: 'enum' | 'range' | 'boolean'
  values?: string[]
  min?: number
  max?: number
}

interface OpenRouterImageModel {
  id: string
  supported_parameters?: Record<string, CapabilityDescriptor>
}

interface OpenRouterImageModelsResponse {
  data?: OpenRouterImageModel[]
  error?: { message?: string } | string
}

interface OpenRouterImageResponse {
  data?: Array<{
    b64_json?: string
    url?: string
    media_type?: string
  }>
  usage?: Record<string, unknown>
  error?: { message?: string } | string
}

interface CachedModels {
  expiresAt: number
  models: Map<string, OpenRouterImageModel>
}

const MODEL_CACHE_TTL_MS = 10 * 60 * 1000
const modelCache = new Map<string, CachedModels>()

function getErrorMessage(
  data: { error?: { message?: string } | string },
  fallback: string,
) {
  return typeof data.error === 'string'
    ? data.error
    : data.error?.message || fallback
}

async function getImageModel(options: {
  apiKey: string
  baseURL: string
  model: string
}): Promise<OpenRouterImageModel> {
  const { apiKey, baseURL, model } = options
  const normalizedBaseURL = baseURL.replace(/\/$/, '')
  let cached = modelCache.get(normalizedBaseURL)

  if (!cached || cached.expiresAt <= Date.now()) {
    const response = await fetchWithTimeout(
      `${normalizedBaseURL}/images/models`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      30000,
    )
    const data: OpenRouterImageModelsResponse = await response
      .json()
      .catch(() => ({}))
    if (!response.ok || !Array.isArray(data.data)) {
      throw new Error(
        getErrorMessage(data, `读取图片模型能力失败 (${response.status})`),
      )
    }

    cached = {
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
      models: new Map(data.data.map((item) => [item.id, item])),
    }
    modelCache.set(normalizedBaseURL, cached)
  }

  const capability = cached.models.get(model)
  if (!capability) {
    throw new Error(
      `OpenRouter 图片模型目录中不存在 ${model}，请检查模型 ID 或改用聊天式引擎`,
    )
  }
  return capability
}

function pickEnumValue(
  descriptor: CapabilityDescriptor | undefined,
  wanted: string,
): string | undefined {
  if (descriptor?.type !== 'enum' || !descriptor.values) return undefined
  return descriptor.values.find(
    (value) => value.toLowerCase() === wanted.toLowerCase(),
  )
}

function buildSupportedParameters(options: {
  model: OpenRouterImageModel
  size: GptImageSize
  quality: GptImageQuality
  aspectRatio: string
}) {
  const { model, size, quality, aspectRatio } = options
  const supported = model.supported_parameters || {}
  const resolution = pickEnumValue(supported.resolution, size.toUpperCase())
  const ratio = pickEnumValue(supported.aspect_ratio, aspectRatio)
  const supportedQuality = pickEnumValue(supported.quality, quality)

  if (supported.resolution && !resolution) {
    logger.info(
      `Model ${model.id} does not support resolution ${size.toUpperCase()}`,
    )
  }
  if (supported.aspect_ratio && !ratio) {
    logger.info(
      `Model ${model.id} does not support aspect ratio ${aspectRatio}`,
    )
  }
  if (supported.quality && !supportedQuality) {
    logger.info(`Model ${model.id} does not support quality ${quality}`)
  }

  return {
    ...(resolution ? { resolution } : {}),
    ...(ratio ? { aspect_ratio: ratio } : {}),
    ...(supportedQuality ? { quality: supportedQuality } : {}),
  }
}

function getMaxImagesPerRequest(model: OpenRouterImageModel): number {
  const descriptor = model.supported_parameters?.n
  if (descriptor?.type !== 'range' || typeof descriptor.max !== 'number') {
    return 1
  }
  return Math.max(1, Math.floor(descriptor.max))
}

function validateReferenceCount(model: OpenRouterImageModel, count: number) {
  if (count === 0) return
  const descriptor = model.supported_parameters?.input_references
  if (descriptor?.type !== 'range' || typeof descriptor.max !== 'number') {
    throw new Error(`模型 ${model.id} 不支持参考图编辑`)
  }
  if (count > descriptor.max) {
    throw new Error(
      `模型 ${model.id} 最多支持 ${descriptor.max} 张参考图，当前选择了 ${count} 张`,
    )
  }
}

function normalizeUsage(usages: Array<Record<string, unknown> | undefined>) {
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost: 0,
  }
  let hasUsage = false

  for (const usage of usages) {
    if (!usage) continue
    hasUsage = true
    const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0)
    const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0)
    totals.input_tokens += Number.isFinite(input) ? input : 0
    totals.output_tokens += Number.isFinite(output) ? output : 0
    totals.total_tokens += Number.isFinite(Number(usage.total_tokens))
      ? Number(usage.total_tokens)
      : input + output
    const cost = Number(usage.cost ?? 0)
    totals.cost += Number.isFinite(cost) ? cost : 0
  }

  return hasUsage ? totals : undefined
}

export async function handleOpenRouterImageGeneration(options: {
  apiKey: string
  baseURL: string
  model: string
  template: TaskTemplate
  size?: GptImageSize
  quality?: GptImageQuality
  endpointName?: string
  writeMetadata?: boolean
}) {
  const {
    apiKey,
    baseURL,
    model,
    template,
    size = '1k',
    quality = 'medium',
    endpointName,
    writeMetadata = true,
  } = options

  const task = await taskManager.createTaskFromTemplate({
    template,
    source: model,
    size,
    quality,
    endpointName,
  })
  await taskManager.updateTaskStatus(task.id, 'running')
  const startTime = Date.now()

  try {
    const capability = await getImageModel({ apiKey, baseURL, model })
    validateReferenceCount(capability, template.images.length)

    const inputReferences: Array<{
      type: 'image_url'
      image_url: { url: string }
    }> = []
    for (const imageUrl of template.images) {
      const filename = imageUrl.split('/').pop()
      if (!filename) continue
      const imagePath = path.join(INPUT_IMAGES_DIR, filename)
      if (!(await fs.pathExists(imagePath))) {
        throw new Error(`Template image not found on Input Dir: ${imagePath}`)
      }
      inputReferences.push({
        type: 'image_url',
        image_url: { url: await readImageAsDataUrl(imagePath) },
      })
    }

    const sharedParameters = buildSupportedParameters({
      model: capability,
      size,
      quality,
      aspectRatio: template.aspectRatio || '1:1',
    })
    const requestedCount = Math.max(1, template.n || 1)
    const maxPerRequest = getMaxImagesPerRequest(capability)
    const batchSizes: number[] = []
    for (
      let remaining = requestedCount;
      remaining > 0;
      remaining -= maxPerRequest
    ) {
      batchSizes.push(Math.min(maxPerRequest, remaining))
    }

    const requestBatch = async (
      count: number,
    ): Promise<OpenRouterImageResponse> => {
      const response = await fetchWithTimeout(
        `${baseURL.replace(/\/$/, '')}/images`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            prompt: buildPromptWithAspectRatio(template),
            ...sharedParameters,
            ...(capability.supported_parameters?.n ? { n: count } : {}),
            ...(inputReferences.length > 0
              ? { input_references: inputReferences }
              : {}),
          }),
        },
        300000,
      )
      const data: OpenRouterImageResponse = await response
        .json()
        .catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, `OpenRouter 返回 ${response.status}`),
        )
      }
      return data
    }

    const results = await Promise.allSettled(batchSizes.map(requestBatch))
    const successful = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    )
    const failedReasons = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )
      .map((result) =>
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      )

    const imageUrls = successful.flatMap((response) =>
      (response.data || []).flatMap((item) => {
        if (item.b64_json) {
          return [
            `data:${item.media_type || 'image/png'};base64,${item.b64_json}`,
          ]
        }
        return item.url ? [item.url] : []
      }),
    )
    if (imageUrls.length === 0) {
      throw new Error(failedReasons[0] || 'OpenRouter 未返回图片数据')
    }
    if (failedReasons.length > 0) {
      logger.error(
        `OpenRouter 部分图片生成失败 (${failedReasons.length}/${batchSizes.length}): ${failedReasons.join('; ')}`,
      )
    }

    const filenames = await persistImages(
      imageUrls,
      writeMetadata
        ? {
            prompt: buildPromptWithAspectRatio(template),
            model,
            engine: 'openrouter-images',
            endpointName,
            requestedSize: size,
            aspectRatio: template.aspectRatio || '1:1',
            quality,
            referenceImageCount: template.images.length,
            generatedAt: new Date().toISOString(),
          }
        : undefined,
    )
    if (filenames.length === 0) {
      throw new Error('OpenRouter 返回的图片格式不受支持或落盘失败')
    }

    const outputUrls = filenames.map(
      (filename) => `${GENERATED_IMAGES_API_PATH}/${filename}`,
    )
    await taskManager.updateTask(task.id, {
      status: 'completed',
      duration: Date.now() - startTime,
      outputUrls,
      gptTokenUsage: normalizeUsage(successful.map((item) => item.usage)),
    })

    logger.info(`OpenRouter image task finished: ${model}`)
    return {
      status: 200,
      data: { success: true as const, outputUrls, taskId: task.id },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to generate image via OpenRouter: ${model}`, message)
    await taskManager.updateTaskStatus(task.id, 'failed', message)
    return {
      status: 500,
      data: { success: false as const, error: message },
    }
  }
}
