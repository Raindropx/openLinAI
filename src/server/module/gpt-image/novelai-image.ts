import fs from 'fs-extra'
import JSZip from 'jszip'
import path from 'path'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { resizeImageToExactDimensions } from '../../common/static/imageProcessor'
import { taskManager } from '../../common/task-manager'
import { TaskTemplate } from '../../common/template-manager'
import { fetchWithTimeout } from '../utils/fetch'
import { logger } from '../utils/logger'
import { GptImageQuality, GptImageSize } from './enum'
import { persistImageBuffers } from './image-files'
import { buildPromptWithAspectRatio } from './index'

interface NovelAIJsonImage {
  image?: string
  index?: number
  seed?: number
}

interface NovelAIJsonResponse {
  images?: NovelAIJsonImage[]
  message?: string
  error?: string | { message?: string }
}

function getErrorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback
  const data = value as NovelAIJsonResponse
  if (typeof data.error === 'string') return data.error
  if (typeof data.error?.message === 'string') return data.error.message
  if (typeof data.message === 'string') return data.message
  return fallback
}

function nearest64(value: number) {
  return Math.max(64, Math.round(value / 64) * 64)
}

function calculateNovelAISize(aspectRatio: string, size: GptImageSize) {
  const [widthPart, heightPart] = aspectRatio.split(':').map(Number)
  const ratio = widthPart > 0 && heightPart > 0 ? widthPart / heightPart : 1
  const longEdge = size === '1k' ? 1024 : size === '2k' ? 1536 : 2048
  let width = ratio >= 1 ? longEdge : longEdge * ratio
  let height = ratio >= 1 ? longEdge / ratio : longEdge

  // NovelAI 当前图片模型的常用上限是横向 2048x1536、纵向 1536x2048。
  const maxWidth = ratio >= 1 ? 2048 : 1536
  const maxHeight = ratio >= 1 ? 1536 : 2048
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  width = nearest64(width * scale)
  height = nearest64(height * scale)
  return { width, height }
}

function isV4OrLater(model: string) {
  return /^nai-diffusion-(?:4|5)(?:-|$)/.test(model)
}

function isV5(model: string) {
  return /^nai-diffusion-5(?:-|$)/.test(model)
}

function buildNovelAIBody(options: {
  model: string
  prompt: string
  width: number
  height: number
  quality: GptImageQuality
  n: number
  seed: number
  image?: string
}) {
  const { model, prompt, width, height, quality, n, seed, image } = options
  const parameters: Record<string, unknown> = {
    cfg_rescale: 0,
    dynamic_thresholding: false,
    legacy: false,
    legacy_v3_extend: false,
    n_samples: n,
    negative_prompt: '',
    params_version: isV5(model) ? 4 : 3,
    noise_schedule: isV4OrLater(model) ? 'karras' : 'native',
    qualityToggle: false,
    sampler: 'k_euler',
    scale: 5,
    seed,
    sm: false,
    sm_dyn: false,
    steps: quality === 'high' ? 28 : 23,
    width,
    height,
  }

  if (isV4OrLater(model)) {
    Object.assign(parameters, {
      use_coords: false,
      prefer_brownian: true,
      deliberate_euler_ancestral_bug: false,
      v4_negative_prompt: {
        legacy_uc: false,
        caption: { base_caption: '', char_captions: [] },
      },
      v4_prompt: {
        use_coords: false,
        use_order: true,
        caption: { base_caption: prompt, char_captions: [] },
      },
    })
  }

  if (isV5(model)) {
    Object.assign(parameters, {
      tag_hint_qt: 1,
      tag_hint_uc_preset: 2,
      straight_alpha: true,
      image_format: 'png',
      add_original_image: true,
    })
    delete parameters.sm
    delete parameters.sm_dyn
    delete parameters.qualityToggle
    delete parameters.skip_cfg_above_sigma
  }

  if (image) {
    Object.assign(parameters, {
      image,
      strength: 0.7,
      noise: 0.1,
      extra_noise_seed: seed,
    })
  }

  return {
    action: image ? 'img2img' : 'generate',
    input: prompt,
    model,
    parameters,
  }
}

async function parseNovelAIImages(response: Response) {
  const contentType = response.headers.get('content-type') || ''
  const buffer = Buffer.from(await response.arrayBuffer())

  if (contentType.includes('application/json')) {
    const data = JSON.parse(buffer.toString('utf8')) as NovelAIJsonResponse
    const images = Array.isArray(data.images) ? data.images : []
    const buffers = images.flatMap((item) => {
      if (!item.image) return []
      const base64 = item.image.includes(',')
        ? item.image.slice(item.image.indexOf(',') + 1)
        : item.image
      return [Buffer.from(base64, 'base64')]
    })
    if (buffers.length === 0) {
      throw new Error(getErrorMessage(data, 'NovelAI 未返回图片数据'))
    }
    return buffers
  }

  if (
    contentType.includes('application/zip') ||
    buffer.subarray(0, 2).toString() === 'PK'
  ) {
    const zip = await JSZip.loadAsync(buffer)
    const files = Object.values(zip.files).filter((file) => !file.dir)
    const buffers = await Promise.all(
      files.map((file) => file.async('nodebuffer')),
    )
    if (buffers.length === 0) throw new Error('NovelAI 返回的 ZIP 中没有图片')
    return buffers
  }

  throw new Error(`NovelAI 返回了不支持的内容类型：${contentType || 'unknown'}`)
}

async function getReferenceImage(
  template: TaskTemplate,
  width: number,
  height: number,
) {
  if (template.images.length === 0) return undefined
  if (template.images.length > 1) {
    throw new Error('NovelAI img2img 当前只支持一张参考图')
  }
  const filename = template.images[0].split('/').pop()
  if (!filename) throw new Error('NovelAI 参考图路径无效')
  const imagePath = path.join(INPUT_IMAGES_DIR, filename)
  if (!(await fs.pathExists(imagePath))) {
    throw new Error(`Template image not found on Input Dir: ${imagePath}`)
  }
  const source = await fs.readFile(imagePath)
  const resized = await resizeImageToExactDimensions(source, width, height)
  return resized.toString('base64')
}

export async function handleNovelAIImageGeneration(options: {
  apiKey: string
  baseURL: string
  model: string
  template: TaskTemplate
  size?: GptImageSize
  quality?: GptImageQuality
  endpointName?: string
  originalPrompt?: string
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
    originalPrompt,
    writeMetadata = true,
  } = options
  const task = await taskManager.createTaskFromTemplate({
    template,
    source: model,
    size,
    quality,
    endpointName,
    originalPrompt,
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
    const prompt = buildPromptWithAspectRatio(template)
    const { width, height } = calculateNovelAISize(
      template.aspectRatio || '1:1',
      size,
    )
    const image = await getReferenceImage(template, width, height)
    const response = await fetchWithTimeout(
      `${baseURL.replace(/\/+$/, '')}/ai/generate-image`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          buildNovelAIBody({
            model,
            prompt,
            width,
            height,
            quality,
            n: Math.max(1, template.n || 1),
            seed: Math.floor(Math.random() * 0x7fffffff),
            image,
          }),
        ),
      },
      10 * 60 * 1000,
    )

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let message = text || `NovelAI 返回 ${response.status}`
      try {
        message = getErrorMessage(JSON.parse(text), message)
      } catch {
        // 保留非 JSON 错误正文。
      }
      throw new Error(message)
    }

    const buffers = await parseNovelAIImages(response)
    const filenames = await persistImageBuffers(
      buffers,
      writeMetadata
        ? {
            prompt,
            originalPrompt,
            model,
            engine: 'novelai-images',
            endpointName,
            requestedSize: size,
            aspectRatio: template.aspectRatio || '1:1',
            quality,
            referenceImageCount: image ? 1 : 0,
            generatedAt: new Date().toISOString(),
          }
        : undefined,
    )
    if (filenames.length === 0) {
      throw new Error('NovelAI 返回的图片格式不受支持或落盘失败')
    }

    const outputUrls = filenames.map(
      (filename) => `${GENERATED_IMAGES_API_PATH}/${filename}`,
    )
    await taskManager.updateTask(task.id, {
      status: 'completed',
      duration: Date.now() - startedAt,
      outputUrls,
      imageBilling: {
        status: 'unavailable',
        currency: 'ANLAS',
        requestIds: [],
      },
    })
    logger.info(`NovelAI image task finished: ${model}`)
    return {
      status: 200,
      data: { success: true as const, outputUrls, taskId: task.id },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to generate image via NovelAI: ${model}`, message)
    await taskManager.updateTaskStatus(task.id, 'failed', message)
    return {
      status: 500,
      data: { success: false as const, error: `[NovelAI] ${message}` },
    }
  }
}
