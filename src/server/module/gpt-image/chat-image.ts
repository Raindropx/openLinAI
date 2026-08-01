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

/** chat-completions 消息中的内容块 */
interface ChatContentPart {
  type: string
  text?: string
  image_url?: { url: string }
  [key: string]: unknown
}

interface ChatChoice {
  message?: {
    content?: string | ChatContentPart[]
    /** OpenRouter 部分图片模型把生成的图片放在此字段 */
    images?: unknown
    [key: string]: unknown
  }
}

interface ChatCompletionResponse {
  choices?: ChatChoice[]
  error?: { message?: string } | string
  [key: string]: unknown
}

const NANO_BANANA_MODEL_MARKERS = [
  'nano-banana',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
]

const NANO_BANANA_ASPECT_RATIO_FALLBACKS: Record<string, string> = {
  '2:1': '16:9',
  '1:2': '9:16',
  '9:21': '9:16',
}

function isNanoBananaModel(model: string): boolean {
  const normalizedModel = model.toLowerCase()
  return NANO_BANANA_MODEL_MARKERS.some((marker) =>
    normalizedModel.includes(marker),
  )
}

function normalizeChatAspectRatio(
  model: string,
  aspectRatio: string,
): string | undefined {
  if (aspectRatio === 'auto') return undefined
  if (!isNanoBananaModel(model)) {
    return aspectRatio
  }

  const normalized = NANO_BANANA_ASPECT_RATIO_FALLBACKS[aspectRatio]
  if (normalized) {
    logger.info(
      `Model ${model} does not support aspect ratio ${aspectRatio}; using ${normalized}`,
    )
  }
  return normalized || aspectRatio
}

/** 从一段字符串里尽力提取图片 URL/data URL */
function extractUrlsFromString(s: string, out: string[]) {
  let m: RegExpExecArray | null
  // markdown 图片 ![...](url)
  const mdImgRe = /!\[[^\]]*\]\(([^)]+)\)/g
  while ((m = mdImgRe.exec(s)) !== null) out.push(m[1])
  // 裸 data URL
  const dataUrlRe = /data:image\/[a-zA-Z+.;-]+;base64,[A-Za-z0-9+/=]+/g
  while ((m = dataUrlRe.exec(s)) !== null) out.push(m[0])
  // 裸 http(s) URL 指向图片
  const httpUrlRe = /https?:\/\/[^\s)"']+\.(?:png|jpe?g|webp|gif)/gi
  while ((m = httpUrlRe.exec(s)) !== null) out.push(m[0])
}

/**
 * 从 chat-completions 响应里提取所有图片（data URL 或 http URL）。
 * 兼容多种 provider 的返回结构：
 * - content 为数组：{ type:'image_url', image_url:{ url } }
 * - content 为字符串：内嵌 markdown / data URL / http URL
 * - message.images：OpenRouter 部分模型把图片放在 message 顶层的 images 数组
 *   形如 [{ type:'image_url', image_url:{ url } }] 或 ['data:image/png;base64,...']
 * - 其他任意含 url / data:image 的字段（递归兜底）
 */
function extractImageUrls(
  content: string | ChatContentPart[] | undefined,
  message?: Record<string, any>,
): {
  imageUrls: string[]
  text: string
} {
  const imageUrls: string[] = []
  let text = ''

  // 1) 解析 content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.image_url?.url && typeof part.image_url.url === 'string') {
        imageUrls.push(part.image_url.url)
      } else if (part.type === 'text' && typeof part.text === 'string') {
        text += part.text
      } else if (typeof part.text === 'string' && !part.image_url) {
        text += part.text
      }
    }
  } else if (typeof content === 'string') {
    text = content
    extractUrlsFromString(content, imageUrls)
  }

  // 2) 解析 message.images（OpenRouter 部分图片模型专用字段）
  if (message && Array.isArray(message.images)) {
    for (const img of message.images) {
      if (typeof img === 'string') {
        imageUrls.push(img)
      } else if (img && typeof img === 'object') {
        if (typeof img.url === 'string') imageUrls.push(img.url)
        else if (img.image_url?.url && typeof img.image_url.url === 'string')
          imageUrls.push(img.image_url.url)
        else if (typeof img.b64_json === 'string')
          imageUrls.push(`data:image/png;base64,${img.b64_json}`)
      }
    }
  }

  // 3) 兜底：还没图，就在整个 message 上递归找含 data:image 或 http 图片 url 的字段
  if (imageUrls.length === 0 && message) {
    const collect = (obj: any, depth = 0) => {
      if (!obj || depth > 5) return
      if (typeof obj === 'string') {
        if (
          obj.startsWith('data:image/') ||
          /^https?:\/\/[^\s]+\.(?:png|jpe?g|webp|gif)/i.test(obj)
        ) {
          imageUrls.push(obj)
        }
        return
      }
      if (Array.isArray(obj)) {
        for (const v of obj) collect(v, depth + 1)
      } else if (typeof obj === 'object') {
        // 跳过已处理过的 content/images，避免重复
        for (const [k, v] of Object.entries(obj)) {
          if (k === 'content' || k === 'images') continue
          collect(v, depth + 1)
        }
      }
    }
    collect(message)
  }

  return { imageUrls, text }
}

/**
 * 使用 chat-completions 引擎（如 Nano Banana / gemini-2.5-flash-image）生成图片。
 * - 图片参数通过 OpenRouter 的 image_config 传递。
 * - chat-completions 没有统一的 n 参数，多图通过多个独立请求实现。
 * - 返回结构与 handleImageGeneration 一致。
 */
export async function handleChatImageGeneration(options: {
  apiKey: string
  baseURL: string
  model: string
  template: TaskTemplate
  size?: GptImageSize
  quality?: GptImageQuality
  endpointName?: string
  writeMetadata?: boolean
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
      writeMetadata = true,
    } = options

    logger.info(`Generating image via chat-completions: ${model}`)

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
        data: { success: false as const, error: 'Failed to create task' },
      }
    }

    await taskManager.updateTaskStatus(task.id, 'running')
    const startTime = Date.now()

    // 读取输入图片 → base64 data URL
    const finalPrompt = buildPromptWithAspectRatio(template)
    const contentParts: ChatContentPart[] = [
      { type: 'text', text: finalPrompt },
    ]
    for (const imgUrl of template.images) {
      const filename = imgUrl.split('/').pop()
      if (!filename) continue
      const imagePath = path.join(INPUT_IMAGES_DIR, filename)
      if (await fs.pathExists(imagePath)) {
        const dataUrl = await readImageAsDataUrl(imagePath)
        contentParts.push({ type: 'image_url', image_url: { url: dataUrl } })
      } else {
        throw new Error(`Template image not found on Input Dir: ${imagePath}`)
      }
    }

    const url = `${baseURL.replace(/\/$/, '')}/chat/completions`
    const aspectRatio = normalizeChatAspectRatio(
      model,
      template.aspectRatio || '1:1',
    )
    const imageConfig = {
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      image_size: size.toUpperCase(),
      quality,
    }
    let filenames: string[] = []
    try {
      const requestOnce = async (): Promise<string[]> => {
        const response = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              // OpenRouter 图片模型要求声明输出模态，否则响应里不会包含图片。
              modalities: ['image', 'text'],
              image_config: imageConfig,
              messages: [
                {
                  role: 'user',
                  content: contentParts,
                },
              ],
            }),
          },
          300000,
        )

        const data: ChatCompletionResponse = await response
          .json()
          .catch(() => ({}))

        if (!response.ok) {
          const errMsg =
            (typeof data.error === 'string'
              ? data.error
              : data.error?.message) || `上游返回 ${response.status}`
          throw new Error(errMsg)
        }

        const message = data.choices?.[0]?.message
        const { imageUrls } = extractImageUrls(message?.content, message)
        if (imageUrls.length > 0) return imageUrls

        const debugPreview = JSON.stringify(message, (_key, value) =>
          typeof value === 'string' && value.length > 160
            ? value.slice(0, 160) + `...(len=${value.length})`
            : value,
        )
        logger.error(
          `Chat-completions 未提取到图片，响应 message 结构: ${debugPreview}`,
        )
        throw new Error('模型未返回图片，详细响应结构已记录到日志')
      }

      const requestedCount = Math.max(1, template.n || 1)
      const results = await Promise.allSettled(
        Array.from({ length: requestedCount }, () => requestOnce()),
      )
      const imageUrls = results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
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

      if (imageUrls.length === 0) {
        throw new Error(failedReasons[0] || '模型未返回图片')
      }
      if (failedReasons.length > 0) {
        logger.error(
          `Chat-completions 部分图片生成失败 (${failedReasons.length}/${requestedCount}): ${failedReasons.join('; ')}`,
        )
      }

      filenames = await persistImages(
        imageUrls,
        writeMetadata
          ? {
              prompt: finalPrompt,
              model,
              engine: 'chat-completions',
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
        throw new Error('模型返回的图片格式不受支持或下载失败')
      }
      logger.info('Chat-completions image generated successfully')
    } catch (error: any) {
      logger.error(
        `Failed to generate image via chat-completions`,
        error.message,
      )
      await taskManager.updateTaskStatus(task.id, 'failed', error.message)
      return {
        status: 500,
        data: { success: false as const, error: error.message },
      }
    }

    const duration = Date.now() - startTime
    const outputUrls = filenames.map((f) => `${GENERATED_IMAGES_API_PATH}/${f}`)
    await taskManager.updateTask(task.id, {
      status: 'completed',
      duration,
      outputUrls,
    })

    logger.info(`Chat-completions image task finished`)
    return {
      status: 200,
      data: { success: true as const, outputUrls, taskId: task.id },
    }
  } catch (error: any) {
    logger.error(`Failed to generate image via chat-completions`, error.message)
    return {
      status: 500,
      data: { success: false as const, error: error.message },
    }
  }
}
