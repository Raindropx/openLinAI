import fs from 'fs-extra'
import JSZip from 'jszip'
import path from 'path'
import type {
  NovelAICharacterPrompt,
  NovelAIGenerationSnapshot,
  NovelAIStudioGenerateRequest,
} from '../../../shared/studio-generation'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { GENERATED_IMAGES_API_PATH, INPUT_IMAGES_API_PATH } from '../../common/static/enum'
import { padImageToExactDimensions, resizeImageToExactDimensions } from '../../common/static/imageProcessor'
import { taskManager } from '../../common/task-manager'
import { TaskTemplate } from '../../common/template-manager'
import { fetchWithTimeout } from '../utils/fetch'
import { logger } from '../utils/logger'
import { GptImageQuality, GptImageSize } from './enum'
import { persistImageBuffers } from './image-files'
import { embedPngTextMetadata, readPngGenerationText } from './generation-metadata'
import { makeNovelAIInpaintOpaque } from './novelai-inpaint-result'
import { compositeFocusedInpaint, prepareFocusedInpaint } from './novelai-focused-inpaint'
import { blurNovelAIInpaintInput } from './novelai-inpaint-input'
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

function inpaintingModel(model: string) {
  if (model === 'nai-diffusion-4-curated-preview')
    return 'nai-diffusion-4-curated-inpainting'
  return `${model}-inpainting`
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
  advanced?: Pick<
    NovelAIStudioGenerateRequest,
    | 'negativePrompt'
    | 'steps'
    | 'scale'
    | 'cfgRescale'
    | 'sampler'
    | 'noiseSchedule'
    | 'qualityToggle'
    | 'qualityPreset'
    | 'ucPreset'
    | 'action'
    | 'strength'
    | 'noise'
    | 'characters'
  >
  mask?: string
  addOriginalImage?: boolean
  preciseImage?: string
  preciseType?: 'character' | 'style' | 'character-and-style'
  preciseStrength?: number
  preciseFidelity?: number
}) {
  const { model, prompt, width, height, quality, n, seed, image, mask, addOriginalImage, advanced, preciseImage, preciseType, preciseStrength, preciseFidelity } =
    options
  const characters: NovelAICharacterPrompt[] = advanced?.characters || []
  const hasPositions = characters.some((character) => character.position)
  const characterPrompts = characters.map((character) => ({
    char_caption: character.prompt,
    centers: character.position ? [character.position] : [],
  }))
  const characterNegativePrompts = characters.map((character) => ({
    char_caption: character.negativePrompt,
    centers: character.position ? [character.position] : [],
  }))
  const parameters: Record<string, unknown> = {
    cfg_rescale: advanced?.cfgRescale ?? 0,
    dynamic_thresholding: false,
    legacy: false,
    legacy_v3_extend: false,
    n_samples: n,
    negative_prompt: advanced?.negativePrompt ?? '',
    params_version: isV5(model) ? 4 : 3,
    noise_schedule:
      advanced?.noiseSchedule || (isV4OrLater(model) ? 'karras' : 'native'),
    qualityToggle: isV5(model) && advanced?.qualityPreset
      ? advanced.qualityPreset !== 'none'
      : advanced?.qualityToggle ?? false,
    sampler: advanced?.sampler || 'k_euler',
    scale: advanced?.scale ?? 5,
    seed,
    sm: false,
    sm_dyn: false,
    steps: advanced?.steps ?? (quality === 'high' ? 28 : 23),
    width,
    height,
  }

  if (isV4OrLater(model)) {
    Object.assign(parameters, {
      use_coords: hasPositions,
      prefer_brownian: true,
      deliberate_euler_ancestral_bug: false,
      v4_negative_prompt: {
        legacy_uc: false,
        caption: {
          base_caption: advanced?.negativePrompt ?? '',
          char_captions: characterNegativePrompts,
        },
      },
      v4_prompt: {
        use_coords: hasPositions,
        use_order: true,
        caption: { base_caption: prompt, char_captions: characterPrompts },
      },
    })
  }

  if (isV5(model)) {
    const qualityPreset = advanced?.qualityPreset ?? (advanced ? (advanced.qualityToggle ? 'standard' : 'none') : 'standard')
    Object.assign(parameters, {
      tag_hint_qt: qualityPreset === 'light' ? 2 : qualityPreset === 'standard' ? 1 : 0,
      tag_hint_uc_preset: advanced?.ucPreset ?? 0,
      straight_alpha: true,
      image_format: 'png',
      add_original_image: true,
    })
    delete parameters.sm
    delete parameters.sm_dyn
    delete parameters.qualityToggle
    delete parameters.skip_cfg_above_sigma
  }

  if (!isV5(model) && advanced?.ucPreset !== undefined) parameters.ucPreset = advanced.ucPreset

  if (preciseImage) {
    Object.assign(parameters, {
      director_reference_images: [preciseImage],
      director_reference_descriptions: [{ caption: { base_caption: preciseType === 'character-and-style' ? 'character&style' : preciseType || 'character', char_captions: [] } }],
      director_reference_information_extracted: [preciseStrength ?? 0.7],
      director_reference_strength_values: [preciseStrength ?? 0.7],
      director_reference_secondary_strength_values: [preciseFidelity ?? 0.7],
    })
  }

  if (image) {
    Object.assign(parameters, {
      image,
      strength: advanced?.strength ?? 0.7,
      noise: advanced?.noise ?? 0.1,
      extra_noise_seed: seed,
    })
  }
  if (mask) {
    parameters.mask = mask
    // NovelAI reads inpainting strength/noise from img2img, not just the
    // top-level fields used by ordinary image-to-image generation.
    parameters.img2img = {
      strength: advanced?.strength ?? 0.7,
      noise: advanced?.noise ?? 0.1,
      extra_noise_seed: seed,
    }
    parameters.add_original_image = addOriginalImage ?? true
  }

  return {
    action: mask ? 'infill' : image ? 'img2img' : 'generate',
    input: prompt,
    model: mask ? inpaintingModel(model) : model,
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
  try {
    const resized = await resizeImageToExactDimensions(source, width, height)
    return resized.toString('base64')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `NovelAI 参考图无法转换为 ${width}×${height} 位图：${message}`,
    )
  }
}

async function getInputImage(url: string): Promise<Buffer> {
  const prefix = `${INPUT_IMAGES_API_PATH}/`
  if (!url.startsWith(prefix)) throw new Error('参考图必须是已上传到本站的文件')
  const filename = url.slice(prefix.length)
  if (!filename || path.basename(filename) !== filename || /[\\/?#]/.test(filename))
    throw new Error('参考图路径无效')
  const location = path.join(INPUT_IMAGES_DIR, filename)
  if (!(await fs.pathExists(location))) throw new Error('参考图文件已不存在，请重新选择')
  return fs.readFile(location)
}

async function getPreciseImage(url: string, width: number, height: number) {
  const source = await getInputImage(url)
  const aspect = width / height
  const [targetWidth, targetHeight] = aspect > 1.15
    ? [1536, 1024]
    : aspect < 0.87
      ? [1024, 1536]
      : [1472, 1472]
  return (await padImageToExactDimensions(source, targetWidth, targetHeight)).toString('base64')
}

async function getMask(url: string, width: number, height: number) {
  const buffer = await getInputImage(url)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!buffer.subarray(0, 8).equals(signature) || buffer.length < 24)
    throw new Error('遮罩必须为 PNG')
  if (buffer.readUInt32BE(16) !== width || buffer.readUInt32BE(20) !== height)
    throw new Error('遮罩尺寸必须与生成尺寸一致，请重新涂抹')
  return buffer.toString('base64')
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
  advanced?: Omit<NovelAIStudioGenerateRequest, 'title' | 'prompt' | 'model'>
  studioRequest?: NovelAIStudioGenerateRequest
  onInpaintRawResult?: (buffer: Buffer, snapshot: NovelAIGenerationSnapshot) => Promise<void>
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
    advanced,
    studioRequest,
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
  const outputUrls: string[] = []
  const snapshots: NovelAIGenerationSnapshot[] = []
  try {
    const prompt = buildPromptWithAspectRatio(template)
    const { width, height } = advanced
      ? { width: advanced.width, height: advanced.height }
      : calculateNovelAISize(template.aspectRatio || '1:1', size)
    const image = await getReferenceImage(template, width, height)
    const action = advanced?.action || (image ? 'img2img' : 'generate')
    if (action !== 'generate' && !image) throw new Error('图生图或局部重绘需要参考图')
    if (action === 'infill' && model === 'nai-diffusion-5-curated')
      throw new Error('V5 Curated 暂无原生局部重绘，请选择 V5 Full 或 V4.5')
    const mask = action === 'infill' && advanced?.maskImageUrl
      ? await getMask(advanced.maskImageUrl, width, height)
      : undefined
    if (action === 'infill' && !mask) throw new Error('局部重绘需要遮罩')
    const originalImage = image ? Buffer.from(image, 'base64') : undefined
    const originalMask = mask ? Buffer.from(mask, 'base64') : undefined
    const focus = advanced?.focusedInpaint && originalImage && originalMask
      ? await prepareFocusedInpaint(
          originalImage, originalMask, width, height, advanced.inpaintContextPixels ?? 128,
          advanced.inpaintBlendMode ?? 'strict', advanced.inpaintFeatherPixels ?? 20,
        )
      : null
    const requestMask = focus?.mask ?? mask
    const requestImage = focus?.image ?? image
    const inpaintImage = action === 'infill' && advanced?.inpaintBase === 'blur' && requestImage && requestMask
      ? (await blurNovelAIInpaintInput(
          Buffer.from(requestImage, 'base64'), Buffer.from(requestMask, 'base64'),
          focus?.targetWidth ?? width, focus?.targetHeight ?? height,
        )).toString('base64')
      : requestImage
    const focusedAdvanced = focus && advanced
      ? {
          ...advanced,
          characters: advanced.characters.map((character) => {
            if (!character.position) return character
            const x = (character.position.x * width - focus.left) / focus.width
            const y = (character.position.y * height - focus.top) / focus.height
            return { ...character, position: x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined }
          }),
        }
      : advanced
    if (advanced?.preciseReference && !/^nai-diffusion-4-5-/.test(model))
      throw new Error('精密参考只支持 V4.5 模型')
    const preciseImage = advanced?.preciseReference
      ? await getPreciseImage(advanced.preciseReference.imageUrl, width, height)
      : undefined
    const count = advanced?.n ?? Math.max(1, template.n || 1)
    const requestedSeed = advanced?.seed ?? -1
    const firstSeed = requestedSeed >= 0
      ? requestedSeed
      : Math.floor(Math.random() * (0x7fffffff - count))

    for (let index = 0; index < count; index += 1) {
      const seed = firstSeed + index
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
            width: focus?.targetWidth ?? width,
            height: focus?.targetHeight ?? height,
            quality,
            n: 1,
            seed,
            image: inpaintImage,
            mask: requestMask,
            // Focused mode composites against the original locally; the provider's
            // hard original-image overlay can leave a visible rectangular seam.
            addOriginalImage: !focus,
            preciseImage,
            preciseType: advanced?.preciseReference?.type,
            preciseStrength: advanced?.preciseReference?.strength,
            preciseFidelity: advanced?.preciseReference?.fidelity,
            advanced: focusedAdvanced,
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

      const snapshot: NovelAIGenerationSnapshot | undefined = studioRequest
        ? {
            version: 1,
            request: { ...studioRequest, seed, n: 1, maskImageUrl: action === 'infill' ? advanced?.maskImageUrl : undefined },
            seed,
            requestedSeed,
            batchSize: count,
            imageIndex: index,
            ...(focus ? { inpaintCrop: { left: focus.left, top: focus.top, width: focus.width, height: focus.height } } : {}),
          }
        : undefined
      const buffers = await parseNovelAIImages(response)
      let output = focus && originalImage && originalMask
        ? await compositeFocusedInpaint(
            originalImage,
            makeNovelAIInpaintOpaque(buffers[0], Buffer.from(focus.mask, 'base64'), prompt),
            originalMask, width, height, focus,
            /\b(?:transparent background|has alpha|alpha transparency)\b/i.test(prompt),
            advanced?.inpaintFeatherPixels ?? 20,
            advanced?.inpaintBlendMode ?? 'strict',
          )
        : mask
          ? makeNovelAIInpaintOpaque(buffers[0], originalMask!, prompt)
          : buffers[0]
      if (focus) {
        for (const [key, value] of Object.entries(readPngGenerationText(buffers[0])))
          output = embedPngTextMetadata(output, key, value)
      }
      const filenames = await persistImageBuffers(
      [output],
      writeMetadata
        ? {
            prompt,
            originalPrompt,
            model,
            engine: 'novelai-images',
            title: template.title,
            endpointName,
            requestedSize: size,
            aspectRatio: template.aspectRatio || '1:1',
            quality,
            referenceImageCount: image ? 1 : 0,
            generatedAt: new Date().toISOString(),
            novelai: snapshot,
          }
        : undefined,
    )
      if (filenames.length === 0) throw new Error('NovelAI 返回的图片格式不受支持或落盘失败')
      outputUrls.push(...filenames.map((filename) => `${GENERATED_IMAGES_API_PATH}/${filename}`))
      if (snapshot) snapshots.push(snapshot)
      await taskManager.updateTask(task.id, { outputUrls, novelaiSnapshots: snapshots })
      if (action === 'infill' && advanced?.saveInpaintRaw && snapshot && options.onInpaintRawResult)
        await options.onInpaintRawResult(buffers[0], snapshot)
    }
    await taskManager.updateTask(task.id, {
      status: 'completed',
      duration: Date.now() - startedAt,
      outputUrls,
      novelaiSnapshots: snapshots,
      ...(snapshots[0] ? { studioProvenance: { origin: 'novelai' as const, sourceTaskId: task.id, model, endpointName, novelai: snapshots[0] } } : {}),
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
    if (outputUrls.length > 0) {
      await taskManager.updateTask(task.id, {
        status: 'completed', duration: Date.now() - startedAt, outputUrls,
        novelaiSnapshots: snapshots,
        studioProvenance: snapshots[0] ? { origin: 'novelai', sourceTaskId: task.id, model, endpointName, novelai: snapshots[0] } : undefined,
      })
      return { status: 200, data: { success: true as const, outputUrls, taskId: task.id, warning: `[NovelAI] 已保留 ${outputUrls.length} 张图片；其余生成失败：${message}` } }
    }
    await taskManager.updateTaskStatus(task.id, 'failed', message)
    return {
      status: 500,
      data: {
        success: false as const,
        error: `[NovelAI] ${message}`,
        taskId: task.id,
      },
    }
  }
}
