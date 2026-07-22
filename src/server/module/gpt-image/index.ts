import crypto from 'crypto'
import fs from 'fs-extra'
import { writeFile } from 'fs/promises'
import OpenAI, { toFile } from 'openai'
import path from 'path'
import {
  GENERATED_IMAGES_DIR,
  INPUT_IMAGES_DIR,
} from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { taskManager } from '../../common/task-manager'
import { TaskTemplate } from '../../common/template-manager'
import { logger } from '../utils/logger'
import { GptImageQuality, GptImageSize } from './enum'

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
  if (imagesToUpload) {
    res = await client.images.edit({
      model,
      image: imagesToUpload || [],
      prompt: prompt,
      n,
      size: size as any,
      quality,
    })
  } else {
    res = await client.images.generate({
      model,
      prompt,
      n,
      size: size as any,
      quality,
      moderation: 'low',
    })
  }

  const filenames: string[] = []

  if (res.data && res.data.length > 0) {
    for (const item of res.data) {
      if (item.b64_json) {
        const imageBuffer = Buffer.from(item.b64_json, 'base64')
        const hash = crypto.createHash('md5').update(imageBuffer).digest('hex')
        const filename = `${hash}.png`
        const filepath = path.join(GENERATED_IMAGES_DIR, filename)
        await writeFile(filepath, imageBuffer)
        filenames.push(filename)
      }
    }
  }

  return {
    filenames,
    usage: res.usage,
  }
}

export async function handleImageGeneration(options: {
  apiKey: string
  baseURL: string
  model: string
  template: TaskTemplate
  size?: GptImageSize
  quality?: GptImageQuality
  endpointName?: string
}) {
  try {
    const {
      apiKey,
      baseURL,
      model,
      template,
      size = '1k',
      quality = 'medium',
      endpointName,
    } = options
    const serviceLabel = getServiceLabel(endpointName, baseURL)

    logger.info(`Generating GPT image`)

    const task = await taskManager.createTaskFromTemplate({
      template,
      source: model,
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
    const startTime = Date.now()

    const finalSize = calculateSize(template.aspectRatio || '1:1', size)

    const imagePaths: string[] = []
    for (const imgUrl of template.images) {
      const filename = imgUrl.split('/').pop()
      if (filename) {
        const imagePath = path.join(INPUT_IMAGES_DIR, filename)
        if (await fs.pathExists(imagePath)) {
          imagePaths.push(imagePath)
        } else {
          throw new Error(`[服务] Template image not found on Input Dir: ${imagePath}`)
        }
      }
    }

    let filenames: string[] = []
    let usage: GPTImageResponse['usage'] | undefined
    try {
      const res = await generateGPTImageNew({
        apiKey,
        baseURL,
        model,
        prompt: buildPromptWithAspectRatio(template),
        size: finalSize,
        quality,
        imagePaths,
        n: template.n || 1,
      })
      logger.info('GPT image generated successfully')
      filenames = res.filenames
      usage = res.usage
    } catch (error: any) {
      const serviceError = `[${serviceLabel}] ${error.message}`
      logger.error(
        `Failed to generate GPT image via ${serviceLabel}`,
        describeError(error),
      )
      await taskManager.updateTaskStatus(task.id, 'failed', serviceError)
      return {
        status: 500,
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
    })

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
