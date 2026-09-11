import fs from 'fs-extra'
import path from 'path'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { taskManager } from '../../common/task-manager'
import { TaskTemplate } from '../../common/template-manager'
import { fetchWithTimeout } from '../utils/fetch'
import { logger } from '../utils/logger'
import {
  getVeniceModel,
  VeniceModelConstraints,
  VeniceModelPricing,
} from '../venice/models'
import { createEstimatedImageBilling } from './billing'
import { GptImageQuality, GptImageSize } from './enum'
import { persistImageBuffers, readImageAsDataUrl } from './image-files'
import { buildPromptWithAspectRatio } from './index'

interface VeniceGenerateResponse {
  images?: string[]
  error?: string | { message?: string }
  message?: string
}

function getErrorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback
  const data = value as VeniceGenerateResponse
  if (typeof data.error === 'string') return data.error
  if (typeof data.error?.message === 'string') return data.error.message
  if (typeof data.message === 'string') return data.message
  return fallback
}

async function getFailedResponseMessage(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text) return `Venice 返回 ${response.status}`
  try {
    return getErrorMessage(JSON.parse(text), text)
  } catch {
    return text
  }
}

function parseAspectRatio(value: string) {
  const [width, height] = value.split(':').map(Number)
  if (!(width > 0) || !(height > 0)) return null
  return width / height
}

function chooseAspectRatio(
  requested: string,
  supported: string[] | undefined,
) {
  if (requested === 'auto') return undefined
  if (!supported?.length) return undefined
  if (supported.includes(requested)) return requested

  const requestedValue = parseAspectRatio(requested)
  if (!requestedValue) return undefined
  const candidates = supported
    .filter((item) => item !== 'auto')
    .map((item) => ({ item, value: parseAspectRatio(item) }))
    .filter(
      (candidate): candidate is { item: string; value: number } =>
        candidate.value !== null,
    )
  candidates.sort(
    (left, right) =>
      Math.abs(Math.log(left.value / requestedValue)) -
      Math.abs(Math.log(right.value / requestedValue)),
  )
  return candidates[0]?.item
}

function chooseResolution(
  requested: GptImageSize,
  supported: string[] | undefined,
) {
  if (!supported?.length) return undefined
  const normalized = requested.toUpperCase()
  if (supported.includes(normalized)) return normalized

  const requestedValue = Number.parseInt(normalized, 10)
  return [...supported].sort(
    (left, right) =>
      Math.abs(Number.parseInt(left, 10) - requestedValue) -
      Math.abs(Number.parseInt(right, 10) - requestedValue),
  )[0]
}

function calculateWidthHeight(
  aspectRatio: string,
  size: GptImageSize,
  divisor = 1,
) {
  const ratio = parseAspectRatio(aspectRatio) || 1
  const longEdge = size === '1k' ? 1024 : 1280
  let width = ratio >= 1 ? longEdge : longEdge * ratio
  let height = ratio >= 1 ? longEdge / ratio : longEdge
  const safeDivisor = Math.max(1, Math.floor(divisor))
  width = Math.max(safeDivisor, Math.round(width / safeDivisor) * safeDivisor)
  height = Math.max(
    safeDivisor,
    Math.round(height / safeDivisor) * safeDivisor,
  )
  return { width, height }
}

function buildModelParameters(options: {
  constraints?: VeniceModelConstraints
  aspectRatio: string
  size: GptImageSize
  quality: GptImageQuality
  allowWidthHeight: boolean
  allowQuality: boolean
}) {
  const { constraints, aspectRatio, size, quality } = options
  const mappedAspectRatio = chooseAspectRatio(
    aspectRatio,
    constraints?.aspectRatios,
  )
  const resolution = chooseResolution(size, constraints?.resolutions)
  const mappedQuality = constraints?.qualities?.includes(quality)
    ? quality
    : undefined

  if (aspectRatio !== 'auto' && mappedAspectRatio !== aspectRatio) {
    logger.info(
      `Venice model does not support aspect ratio ${aspectRatio}; using ${mappedAspectRatio || 'pixel dimensions'}`,
    )
  }
  if (resolution && resolution !== size.toUpperCase()) {
    logger.info(
      `Venice model does not support resolution ${size.toUpperCase()}; using ${resolution}`,
    )
  }

  const widthHeight =
    options.allowWidthHeight &&
    !constraints?.aspectRatios?.length &&
    !constraints?.resolutions?.length
      ? calculateWidthHeight(
          aspectRatio,
          size,
          constraints?.widthHeightDivisor,
        )
      : undefined

  return {
    ...(mappedAspectRatio ? { aspect_ratio: mappedAspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(options.allowQuality && mappedQuality ? { quality: mappedQuality } : {}),
    ...widthHeight,
  }
}

function validatePrompt(prompt: string, constraints?: VeniceModelConstraints) {
  const limit = constraints?.promptCharacterLimit
  if (limit && prompt.length > limit) {
    throw new Error(`提示词长度 ${prompt.length} 超过 Venice 模型上限 ${limit}`)
  }
}

export function estimateVeniceImageCost(options: {
  pricing: VeniceModelPricing | undefined
  parameters: Record<string, unknown>
  hasReferences: boolean
  referenceCount: number
  completedRequests: number
}) {
  const { pricing, parameters } = options
  if (!pricing || options.completedRequests < 1) return null
  const resolution =
    typeof parameters.resolution === 'string'
      ? parameters.resolution.toUpperCase()
      : undefined
  const quality =
    typeof parameters.quality === 'string'
      ? parameters.quality.toLowerCase()
      : undefined
  const unitPrice =
    (resolution && quality
      ? pricing.quality?.[resolution]?.[quality]?.usd
      : undefined) ??
    (resolution ? pricing.resolutions?.[resolution]?.usd : undefined) ??
    (options.hasReferences ? pricing.inpaint?.usd : pricing.generation?.usd)
  if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice)) return null

  const includedImages = Math.max(0, pricing.inputImages?.included || 0)
  const additionalImagePrice = pricing.inputImages?.additional?.usd || 0
  const extraImages = options.hasReferences
    ? Math.max(0, options.referenceCount - includedImages)
    : 0
  return (
    (unitPrice + extraImages * additionalImagePrice) *
    options.completedRequests
  )
}

async function readTemplateImages(template: TaskTemplate) {
  const images: string[] = []
  for (const imageUrl of template.images) {
    const filename = imageUrl.split('/').pop()
    if (!filename) continue
    const imagePath = path.join(INPUT_IMAGES_DIR, filename)
    if (!(await fs.pathExists(imagePath))) {
      throw new Error(`Template image not found on Input Dir: ${imagePath}`)
    }
    images.push(await readImageAsDataUrl(imagePath))
  }
  return images
}

async function requestVeniceGeneration(options: {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  parameters: Record<string, unknown>
}) {
  const response = await fetchWithTimeout(
    `${options.baseURL.replace(/\/+$/, '')}/image/generate`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        prompt: options.prompt,
        format: 'png',
        safe_mode: false,
        ...options.parameters,
      }),
    },
    300000,
  )
  const data: VeniceGenerateResponse = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(getErrorMessage(data, `Venice 返回 ${response.status}`))
  }
  if (!Array.isArray(data.images) || data.images.length === 0) {
    throw new Error('Venice 未返回图片数据')
  }
  return data.images.map((image) => {
    const base64 = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image
    return Buffer.from(base64, 'base64')
  })
}

async function requestVeniceEdit(options: {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  images: string[]
  parameters: Record<string, unknown>
}) {
  const multiple = options.images.length > 1
  const response = await fetchWithTimeout(
    `${options.baseURL.replace(/\/+$/, '')}${
      multiple ? '/image/multi-edit' : '/image/edit'
    }`,
    {
      method: 'POST',
      headers: {
        Accept: 'image/png',
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(multiple
          ? { modelId: options.model, images: options.images }
          : { model: options.model, image: options.images[0] }),
        prompt: options.prompt,
        output_format: 'png',
        safe_mode: false,
        ...options.parameters,
      }),
    },
    300000,
  )
  if (!response.ok) {
    throw new Error(await getFailedResponseMessage(response))
  }
  return Buffer.from(await response.arrayBuffer())
}

export async function handleVeniceImageGeneration(options: {
  apiKey: string
  baseURL: string
  model: string
  editModel?: string
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
    editModel,
    template,
    size = '1k',
    quality = 'medium',
    endpointName,
    writeMetadata = true,
  } = options
  const hasReferences = template.images.length > 0
  const activeModel = hasReferences ? editModel : model
  if (!activeModel) {
    return {
      status: 400,
      data: {
        success: false as const,
        error: '[配置] Venice 参考图任务需要配置编辑模型',
      },
    }
  }

  const task = await taskManager.createTaskFromTemplate({
    template,
    source: activeModel,
    size,
    quality,
    endpointName,
  })
  if (!task) {
    return {
      status: 500,
      data: { success: false as const, error: '[服务] Failed to create task' },
    }
  }
  await taskManager.updateTaskStatus(task.id, 'running')
  const startedAt = Date.now()

  try {
    const modelType = hasReferences ? 'inpaint' : 'image'
    const catalogModel = await getVeniceModel({
      type: modelType,
      model: activeModel,
      baseURL,
      apiKey,
    })
    const constraints = catalogModel.model_spec?.constraints
    const prompt = buildPromptWithAspectRatio(template)
    validatePrompt(prompt, constraints)

    const referenceImages = hasReferences
      ? await readTemplateImages(template)
      : []
    if (
      constraints?.maxInputImages &&
      referenceImages.length > constraints.maxInputImages
    ) {
      throw new Error(
        `Venice 编辑模型最多接受 ${constraints.maxInputImages} 张参考图，当前为 ${referenceImages.length} 张`,
      )
    }

    const parameters = buildModelParameters({
      constraints,
      aspectRatio: template.aspectRatio || '1:1',
      size,
      quality,
      allowWidthHeight: !hasReferences,
      allowQuality: !hasReferences || referenceImages.length > 1,
    })
    const requestedCount = Math.max(1, template.n || 1)
    const buffers: Buffer[] = []
    const failures: string[] = []

    for (let index = 0; index < requestedCount; index++) {
      try {
        if (hasReferences) {
          buffers.push(
            await requestVeniceEdit({
              apiKey,
              baseURL,
              model: activeModel,
              prompt,
              images: referenceImages,
              parameters,
            }),
          )
        } else {
          buffers.push(
            ...(await requestVeniceGeneration({
              apiKey,
              baseURL,
              model: activeModel,
              prompt,
              parameters,
            })),
          )
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }

    if (buffers.length === 0) {
      throw new Error(failures[0] || 'Venice 未返回图片数据')
    }
    if (failures.length > 0) {
      logger.error(
        `Venice 部分图片生成失败 (${failures.length}/${requestedCount}): ${failures.join('; ')}`,
      )
    }

    const filenames = await persistImageBuffers(
      buffers,
      writeMetadata
        ? {
            prompt,
            model: activeModel,
            engine: 'venice-images',
            endpointName,
            requestedSize: size,
            aspectRatio: template.aspectRatio || '1:1',
            quality,
            referenceImageCount: referenceImages.length,
            generatedAt: new Date().toISOString(),
          }
        : undefined,
    )
    if (filenames.length === 0) {
      throw new Error('Venice 返回的图片格式不受支持或落盘失败')
    }

    const outputUrls = filenames.map(
      (filename) => `${GENERATED_IMAGES_API_PATH}/${filename}`,
    )
    const completedRequests = requestedCount - failures.length
    const estimatedCost = estimateVeniceImageCost({
      pricing: catalogModel.model_spec?.pricing,
      parameters,
      hasReferences,
      referenceCount: referenceImages.length,
      completedRequests,
    })
    await taskManager.updateTask(task.id, {
      status: 'completed',
      duration: Date.now() - startedAt,
      outputUrls,
      imageBilling:
        estimatedCost === null
          ? {
              status: 'unavailable',
              currency: 'USD',
              requestIds: [],
              source: 'model-pricing',
            }
          : createEstimatedImageBilling({
              currency: 'USD',
              cost: estimatedCost,
              note: `生成时读取的 Venice 模型目录价格，按 ${completedRequests} 次成功请求计算`,
            }),
    })
    logger.info(`Venice image task finished: ${activeModel}`)
    return {
      status: 200,
      data: { success: true as const, outputUrls, taskId: task.id },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to generate image via Venice: ${activeModel}`, message)
    await taskManager.updateTaskStatus(task.id, 'failed', message)
    return {
      status: 500,
      data: { success: false as const, error: message },
    }
  }
}
