import fs from 'fs-extra'
import OpenAI, { toFile } from 'openai'
import path from 'path'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { taskManager } from '../../common/task-manager'
import { TaskTemplate } from '../../common/template-manager'
import { logger } from '../utils/logger'
import { fetchImageBill, getBillingRequestId } from './billing'
import { GptImageQuality, GptImageSize } from './enum'
import type { GenerationMetadataInput } from './generation-metadata'
import { persistImageBuffers } from './image-files'

interface GPTImageResponse {
  created: number
  data: Array<{
    url?: string
    b64_json?: string
  }>
  usage?: {
    total_tokens: number
    input_tokens: number
    output_tokens: number
    input_tokens_details?: {
      text_tokens: number
      image_tokens: number
    }
  }
}

interface GenerateGPTImageOptions {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  size: string
  quality: GptImageQuality
  imagePaths: string[]
  n?: number
  generationMetadata?: GenerationMetadataInput
}

function isPollinationsBaseURL(baseURL: string) {
  try {
    return new URL(baseURL).hostname === 'gen.pollinations.ai'
  } catch {
    return false
  }
}

function mergeUsage(
  current: GPTImageResponse['usage'] | undefined,
  next: GPTImageResponse['usage'] | undefined,
) {
  if (!next) return current
  if (!current) return next
  return {
    total_tokens: current.total_tokens + next.total_tokens,
    input_tokens: current.input_tokens + next.input_tokens,
    output_tokens: current.output_tokens + next.output_tokens,
    input_tokens_details:
      current.input_tokens_details || next.input_tokens_details
        ? {
            text_tokens:
              (current.input_tokens_details?.text_tokens || 0) +
              (next.input_tokens_details?.text_tokens || 0),
            image_tokens:
              (current.input_tokens_details?.image_tokens || 0) +
              (next.input_tokens_details?.image_tokens || 0),
          }
        : undefined,
  }
}

/** OpenAI client 缓存，按 apiKey+baseURL 复用，避免每次请求重建连接池 */
const openaiClientCache = new Map<string, OpenAI>()
const IMAGE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000

function getOpenAIClient(apiKey: string, baseURL: string): OpenAI {
  const cacheKey = `${apiKey}:${baseURL}`
  let client = openaiClientCache.get(cacheKey)
  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL,
      timeout: IMAGE_REQUEST_TIMEOUT_MS,
      // 生图请求会产生费用且不具备幂等性。SDK 默认的两次自动重试可能在
      // 回包连接中断时重复提交已经完成的请求，造成多次生成和重复扣费。
      maxRetries: 0,
    })
    openaiClientCache.set(cacheKey, client)
  }
  return client
}

function describeError(error: unknown): string {
  const chain: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current != null && !seen.has(current) && chain.length < 5) {
    seen.add(current)

    if (current instanceof Error) {
      const details = current as Error & {
        code?: unknown
        errno?: unknown
        syscall?: unknown
        cause?: unknown
      }
      const metadata = [
        typeof details.code === 'string' ? `code=${details.code}` : null,
        typeof details.errno === 'string' || typeof details.errno === 'number'
          ? `errno=${details.errno}`
          : null,
        typeof details.syscall === 'string'
          ? `syscall=${details.syscall}`
          : null,
      ].filter(Boolean)
      chain.push(
        `${current.name}: ${current.message}${
          metadata.length > 0 ? ` (${metadata.join(', ')})` : ''
        }`,
      )
      current = details.cause
      continue
    }

    chain.push(typeof current === 'string' ? current : String(current))
    break
  }

  return chain.join(' <- ')
}

function getErrorStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return 500
  }

  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && status >= 400 && status <= 599
    ? status
    : 500
}

/**
 * SDK 的 APIConnectionError.message 固定为 "Connection error."，真正的网络
 * 原因位于 cause 链；HTTP 错误则可能把状态码放在 status 而非 message 中。
 * 将两者整理成适合任务列表展示、复制的单行错误信息。
 */
function getUserFacingError(error: unknown): string {
  if (!(error instanceof Error)) return describeError(error) || 'Unknown error'

  const details = error as Error & { cause?: unknown; status?: unknown }
  const status = getErrorStatus(error)
  const statusPrefix =
    status !== 500 || details.status === 500
      ? new RegExp(`^${status}\\b`).test(error.message)
        ? ''
        : `${status} `
      : ''
  const cause = details.cause ? describeError(details.cause) : ''

  return `${statusPrefix}${error.message}${cause ? ` <- ${cause}` : ''}`
}

function getServiceLabel(endpointName: string | undefined, baseURL: string) {
  if (endpointName?.trim()) return endpointName.trim()
  try {
    return new URL(baseURL).hostname || '上游服务'
  } catch {
    return '上游服务'
  }
}

function getInputImageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.avif':
      return 'image/avif'
    default:
      throw new Error(
        `[服务] Unsupported input image format: ${path.extname(filePath) || 'unknown'}`,
      )
  }
}

/**
 * 根据模板生成最终提示词。当 injectAspectRatio 为 true 且 aspectRatio 有效（非 auto）时，
 * 在提示词末尾追加“。画面比例X:Y”，用于不支持 size 参数的模型。
 */
export function buildPromptWithAspectRatio(template: TaskTemplate): string {
  const prompt = template.prompt
  if (!template.injectAspectRatio) return prompt
  const ratio = template.aspectRatio
  if (!ratio || ratio === 'auto') return prompt
  return `${prompt}。画面比例${ratio}`
}

function calculateSize(aspectRatio: string, baseSize: GptImageSize): string {
  // auto：交由模型自行决定尺寸（如 GPT-image-1 的 auto）
  if (aspectRatio === 'auto') {
    return 'auto'
  }
  const [wStr, hStr] = aspectRatio.split(':')
  const wRatio = parseInt(wStr, 10)
  const hRatio = parseInt(hStr, 10)

  let targetSize: number
  if (baseSize === '1k') targetSize = 1024
  else if (baseSize === '2k') targetSize = 2048
  else if (baseSize === '4k') targetSize = 3840
  else targetSize = 1024

  let width: number
  let height: number

  if (isNaN(wRatio) || isNaN(hRatio) || hRatio === 0) {
    width = targetSize
    height = targetSize
  } else {
    const ratio = wRatio / hRatio
    if (baseSize === '1k') {
      // 1k: 保留短边 1024
      if (ratio >= 1) {
        height = targetSize
        width = Math.round((targetSize * ratio) / 16) * 16
      } else {
        width = targetSize
        height = Math.round(targetSize / ratio / 16) * 16
      }
    } else {
      // 2k 和 4k: 保留长边 2048 / 3840
      if (ratio >= 1) {
        width = targetSize
        height = Math.round(targetSize / ratio / 16) * 16
      } else {
        height = targetSize
        width = Math.round((targetSize * ratio) / 16) * 16
      }
    }
  }

  const MAX_PIXELS = 8294400
  if (width * height > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / (width * height))
    width = Math.floor((width * scale) / 16) * 16
    height = Math.floor((height * scale) / 16) * 16

    if (width === 0) width = 16
    if (height === 0) height = 16
  }

  return `${width}x${height}`
}

async function generateGPTImageNew(options: GenerateGPTImageOptions) {
  const {
    apiKey,
    baseURL,
    model,
    prompt,
    size,
    quality,
    imagePaths: images,
    n = 1,
    generationMetadata,
  } = options
  const client = getOpenAIClient(apiKey, baseURL)
  const imagesToUpload = images.length
    ? await Promise.all(
        images.map(
          async (file) =>
            await toFile(fs.createReadStream(file), path.basename(file), {
              type: getInputImageMimeType(file),
            }),
        ),
      )
    : undefined

  let res: OpenAI.Images.ImagesResponse
  let requestId: string | undefined
  if (imagesToUpload) {
    const response = await client.images
      .edit({
        model,
        image: imagesToUpload || [],
        prompt: prompt,
        n,
        size: size as any,
        quality,
      })
      .withResponse()
    res = response.data
    requestId = getBillingRequestId(response.response.headers)
  } else {
    const response = await client.images
      .generate({
        model,
        prompt,
        n,
        size: size as any,
        quality,
        moderation: 'low',
      })
      .withResponse()
    res = response.data
    requestId = getBillingRequestId(response.response.headers)
  }

  const imageBuffers: Buffer[] = []

  if (res.data && res.data.length > 0) {
    for (const item of res.data) {
      let imageBuffer: Buffer | undefined

      if (item.b64_json) {
        imageBuffer = Buffer.from(item.b64_json, 'base64')
      } else if (item.url) {
        const imageResponse = await fetch(item.url)
        if (!imageResponse.ok) {
          throw new Error(
            `Failed to download generated image: ${imageResponse.status} ${imageResponse.statusText}`,
          )
        }
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
      }

      if (imageBuffer) {
        imageBuffers.push(imageBuffer)
      }
    }
  }

  const filenames = await persistImageBuffers(imageBuffers, generationMetadata)

  return {
    filenames,
    usage: res.usage,
    requestId,
  }
}

export async function handleImageGeneration(options: {
  apiKey: string
  baseURL: string
  model: string
  editModel?: string
  template: TaskTemplate
  size?: GptImageSize
  quality?: GptImageQuality
  endpointName?: string
  writeMetadata?: boolean
  queryBilling?: boolean
}) {
  try {
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
      queryBilling = false,
    } = options
    const serviceLabel = getServiceLabel(endpointName, baseURL)
    const activeModel = template.images.length > 0 ? editModel || model : model

    logger.info(`Generating GPT image`)

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
        data: {
          success: false as const,
          error: '[服务] Failed to create task',
        },
      }
    }

    await taskManager.updateTaskStatus(task.id, 'running')
    const startTime = Date.now()

    const imagePaths: string[] = []
    let filenames: string[] = []
    let usage: GPTImageResponse['usage'] | undefined
    const requestIds: string[] = []
    let missingRequestId = false
    try {
      const finalSize = calculateSize(template.aspectRatio || '1:1', size)

      for (const imgUrl of template.images) {
        const filename = imgUrl.split('/').pop()
        if (filename) {
          const imagePath = path.join(INPUT_IMAGES_DIR, filename)
          if (await fs.pathExists(imagePath)) {
            imagePaths.push(imagePath)
          } else {
            throw new Error(
              `Template image not found on Input Dir: ${imagePath}`,
            )
          }
        }
      }

      const finalPrompt = buildPromptWithAspectRatio(template)
      const requestedCount = Math.max(1, template.n || 1)
      const requestCounts =
        isPollinationsBaseURL(baseURL) && requestedCount > 1
          ? Array.from({ length: requestedCount }, () => 1)
          : [requestedCount]
      const requestErrors: unknown[] = []
      for (const requestCount of requestCounts) {
        try {
          const res = await generateGPTImageNew({
            apiKey,
            baseURL,
            model: activeModel,
            prompt: finalPrompt,
            size: finalSize,
            quality,
            imagePaths,
            n: requestCount,
            generationMetadata: writeMetadata
              ? {
                  prompt: finalPrompt,
                  model: activeModel,
                  engine: 'images',
                  endpointName,
                  requestedSize: size,
                  aspectRatio: template.aspectRatio || '1:1',
                  quality,
                  referenceImageCount: imagePaths.length,
                  generatedAt: new Date().toISOString(),
                }
              : undefined,
          })
          filenames.push(...res.filenames)
          usage = mergeUsage(usage, res.usage)
          if (res.requestId) requestIds.push(res.requestId)
          else missingRequestId = true
        } catch (error) {
          requestErrors.push(error)
          if (requestCounts.length === 1) throw error
        }
      }
      if (filenames.length === 0) {
        throw requestErrors[0] || new Error('Image API returned no images')
      }
      if (requestCounts.length > 1 && filenames.length < requestedCount) {
        logger.warn(
          `Pollinations returned ${filenames.length}/${requestedCount} images`,
        )
      }
      logger.info('GPT image generated successfully')
    } catch (error: any) {
      const serviceError = `[${serviceLabel}] ${getUserFacingError(error)}`
      logger.error(
        `Failed to generate GPT image via ${serviceLabel}`,
        describeError(error),
      )
      await taskManager.updateTaskStatus(task.id, 'failed', serviceError)
      return {
        status: getErrorStatus(error),
        data: { success: false as const, error: serviceError },
      }
    }

    const duration = Date.now() - startTime
    const outputUrls = filenames.map((f) => `${GENERATED_IMAGES_API_PATH}/${f}`)
    await taskManager.updateTask(task.id, {
      status: 'completed',
      duration,
      outputUrls,
      gptTokenUsage: usage,
      ...(queryBilling
        ? {
            imageBilling: {
              status:
                missingRequestId || !requestIds.length
                  ? ('unavailable' as const)
                  : ('pending' as const),
              currency: 'USD' as const,
              requestIds,
            },
          }
        : {}),
    })

    if (queryBilling && !missingRequestId && requestIds.length) {
      void fetchImageBill({ baseURL, apiKey, requestIds })
        .then((imageBilling) =>
          taskManager.updateTask(task.id, { imageBilling }),
        )
        .catch(() => logger.warn('Unable to save image billing result'))
    }

    logger.info(`GPT image task finished`)
    return {
      status: 200,
      data: { success: true as const, outputUrls, taskId: task.id },
    }
  } catch (error: any) {
    logger.error(`Failed to generate GPT image`, describeError(error))
    return {
      status: 500,
      data: { success: false as const, error: `[服务] ${error.message}` },
    }
  }
}
