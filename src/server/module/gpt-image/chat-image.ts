import crypto from 'crypto'
import fs from 'fs-extra'
import { writeFile } from 'fs/promises'
import path from 'path'
import {
  GENERATED_IMAGES_DIR,
  INPUT_IMAGES_DIR,
} from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { taskManager } from '../../common/task-manager'
import { TaskTemplate } from '../../common/template-manager'
import { buildPromptWithAspectRatio } from './index'
import { fetchWithTimeout } from '../utils/fetch'
import { logger } from '../utils/logger'

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

/** 读取输入图片文件并转成 base64 data URL */
async function readImageAsDataUrl(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  const base64 = buffer.toString('base64')
  // 简单按扩展名判定 mime；默认 png
  const ext = path.extname(filePath).toLowerCase()
  const mime =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/png'
  return `data:${mime};base64,${base64}`
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

interface PersistedImageFormat {
  extension: 'jpg' | 'png' | 'webp' | 'gif' | 'avif'
}

const MIME_FORMATS: Record<string, PersistedImageFormat> = {
  'image/jpeg': { extension: 'jpg' },
  'image/jpg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
  'image/gif': { extension: 'gif' },
  'image/avif': { extension: 'avif' },
}

function detectImageFormat(
  buffer: Buffer,
  mimeHint?: string | null,
): PersistedImageFormat | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return MIME_FORMATS['image/jpeg']
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return MIME_FORMATS['image/png']
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return MIME_FORMATS['image/webp']
  }

  if (buffer.length >= 6) {
    const signature = buffer.toString('ascii', 0, 6)
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return MIME_FORMATS['image/gif']
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp' &&
    ['avif', 'avis'].includes(buffer.toString('ascii', 8, 12))
  ) {
    return MIME_FORMATS['image/avif']
  }

  const normalizedMime = mimeHint?.split(';', 1)[0].trim().toLowerCase()
  return normalizedMime ? MIME_FORMATS[normalizedMime] || null : null
}

/** 把图片（data URL 或 http URL）按真实格式落盘，返回文件名列表 */
async function persistImages(imageUrls: string[]): Promise<string[]> {
  const filenames: string[] = []
  for (const url of imageUrls) {
    let buffer: Buffer
    let mimeHint: string | null = null
    if (url.startsWith('data:')) {
      const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(url)
      if (!match) continue
      mimeHint = match[1]
      buffer = Buffer.from(match[2], 'base64')
    } else {
      const res = await fetchWithTimeout(url, {}, 30000)
      if (!res.ok) {
        logger.error(`Failed to fetch image: ${url} (${res.status})`)
        continue
      }
      mimeHint = res.headers.get('content-type')
      const arrayBuffer = await res.arrayBuffer()
      buffer = Buffer.from(arrayBuffer)
    }

    const format = detectImageFormat(buffer, mimeHint)
    if (!format) {
      logger.error(`Unsupported generated image format: ${mimeHint || 'unknown'}`)
      continue
    }

    const hash = crypto.createHash('md5').update(buffer).digest('hex')
    const filename = `${hash}.${format.extension}`
    const filepath = path.join(GENERATED_IMAGES_DIR, filename)
    await writeFile(filepath, buffer)
    filenames.push(filename)
  }
  return filenames
}

/**
 * 使用 chat-completions 引擎（如 Nano Banana / gemini-2.5-flash-image）生成图片。
 * - 不支持 size/quality/n（chat-completions 不接受这些参数）。
 * - 返回结构与 handleImageGeneration 一致。
 */
export async function handleChatImageGeneration(options: {
  apiKey: string
  baseURL: string
  model: string
  template: TaskTemplate
  endpointName?: string
}) {
  try {
    const { apiKey, baseURL, model, template, endpointName } = options

    logger.info(`Generating image via chat-completions: ${model}`)

    const task = await taskManager.createTaskFromTemplate({
      template,
      source: model,
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
    const contentParts: ChatContentPart[] = [
      { type: 'text', text: buildPromptWithAspectRatio(template) },
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
    let filenames: string[] = []
    try {
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
            // OpenRouter 的图片生成模型（如 Nano Banana）要求声明 modalities 才会返回图片，
            // 否则即使模型生成了图，响应里也不会包含 image 内容块。
            modalities: ['image', 'text'],
            messages: [
              {
                role: 'user',
                content: contentParts,
              },
            ],
          }),
        },
        120000,
      )

      const data: ChatCompletionResponse = await response
        .json()
        .catch(() => ({}))

      if (!response.ok) {
        const errMsg =
          (typeof data.error === 'string'
            ? data.error
            : data.error?.message) ||
          `上游返回 ${response.status}` ||
          'Chat completion request failed'
        throw new Error(errMsg)
      }

      const message = data.choices?.[0]?.message
      const messageContent = message?.content
      const { imageUrls } = extractImageUrls(messageContent, message)

      if (imageUrls.length === 0) {
        // 记录整个 message 结构便于排查（裁剪超长内容，避免日志爆炸）
        const debugPreview = JSON.stringify(
          message,
          (_key, value) => {
            if (typeof value === 'string' && value.length > 160) {
              return value.slice(0, 160) + `...(len=${value.length})`
            }
            return value
          },
        )
        logger.error(
          `Chat-completions 未提取到图片，响应 message 结构: ${debugPreview}`,
        )
        throw new Error(
          '模型未返回图片（部分情况下中文提示词可能不返图，可尝试英文提示词）。详细响应结构已记录到日志。',
        )
      }

      filenames = await persistImages(imageUrls)
      if (filenames.length === 0) {
        throw new Error('模型返回的图片格式不受支持或下载失败')
      }
      logger.info('Chat-completions image generated successfully')
    } catch (error: any) {
      logger.error(`Failed to generate image via chat-completions`, error.message)
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
