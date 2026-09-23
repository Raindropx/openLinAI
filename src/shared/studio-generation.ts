export const NOVELAI_IMAGE_MODELS = [
  { id: 'nai-diffusion-5-full', name: 'NovelAI Diffusion V5 Full' },
  { id: 'nai-diffusion-5-curated', name: 'NovelAI Diffusion V5 Curated' },
  { id: 'nai-diffusion-4-5-full', name: 'NovelAI Diffusion V4.5 Full' },
  {
    id: 'nai-diffusion-4-5-curated',
    name: 'NovelAI Diffusion V4.5 Curated',
  },
  { id: 'nai-diffusion-4-full', name: 'NovelAI Diffusion V4 Full' },
  {
    id: 'nai-diffusion-4-curated-preview',
    name: 'NovelAI Diffusion V4 Curated',
  },
] as const

export const NOVELAI_SAMPLERS = [
  'k_euler',
  'k_euler_ancestral',
  'k_dpmpp_2s_ancestral',
  'k_dpmpp_2m',
  'k_dpmpp_sde',
  'ddim_v3',
] as const

export const NOVELAI_NOISE_SCHEDULES = [
  'karras',
  'exponential',
  'polyexponential',
  'native',
] as const

const NOVELAI_SIZE_STEP = 64
const NOVELAI_NORMAL_PIXELS = 1024 * 1024
const NOVELAI_MIN_DIMENSION = 256

/**
 * 为 img2img 选择接近参考图比例的 NovelAI 常规尺寸。
 * 候选边长使用 64 的倍数，总像素不超过 1024²，并遵守横竖图的最长边上限。
 */
export function calculateNovelAIImg2ImgSize(
  sourceWidth: number,
  sourceHeight: number,
) {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error('参考图尺寸无效')
  }

  const sourceRatio = sourceWidth / sourceHeight
  const landscape = sourceRatio >= 1
  const maxWidth = landscape ? 2048 : 1536
  const maxHeight = landscape ? 1536 : 2048
  let best:
    | { width: number; height: number; score: number; pixels: number }
    | undefined

  for (
    let width = NOVELAI_MIN_DIMENSION;
    width <= maxWidth;
    width += NOVELAI_SIZE_STEP
  ) {
    for (
      let height = NOVELAI_MIN_DIMENSION;
      height <= maxHeight;
      height += NOVELAI_SIZE_STEP
    ) {
      const pixels = width * height
      if (pixels > NOVELAI_NORMAL_PIXELS) continue
      const aspectError = Math.abs(Math.log(width / height / sourceRatio))
      const unusedArea = 1 - pixels / NOVELAI_NORMAL_PIXELS
      // 比例误差是首要因素，面积只用于在接近比例中挑选更高清的桶。
      const score = aspectError * 4 + unusedArea * 0.25
      if (
        !best ||
        score < best.score - 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && pixels > best.pixels)
      ) {
        best = { width, height, score, pixels }
      }
    }
  }

  if (!best) throw new Error('无法为参考图匹配 NovelAI 尺寸')
  return { width: best.width, height: best.height }
}

export interface StudioProviderStatus {
  configured: boolean
  keyHint?: string
}

export interface StudioProviderSettings {
  novelai: StudioProviderStatus & { model: string }
  civitai: StudioProviderStatus
}

export interface NovelAICharacterPrompt {
  prompt: string
  negativePrompt: string
  /** 手动角色位置，坐标相对于画布归一化至 0–1。 */
  position?: { x: number; y: number }
}

export type NovelAIAction = 'generate' | 'img2img' | 'infill'
export type NovelAIQualityPreset = 'none' | 'light' | 'standard'

export interface NovelAIPreciseReference {
  imageUrl: string
  type: 'character' | 'style' | 'character-and-style'
  fidelity: number
  strength: number
}

export interface NovelAIStudioGenerateRequest {
  title?: string
  prompt: string
  negativePrompt: string
  model: string
  width: number
  height: number
  steps: number
  scale: number
  cfgRescale: number
  sampler: (typeof NOVELAI_SAMPLERS)[number]
  noiseSchedule: (typeof NOVELAI_NOISE_SCHEDULES)[number]
  seed: number
  n: number
  qualityToggle: boolean
  qualityPreset?: NovelAIQualityPreset
  ucPreset?: number
  action?: NovelAIAction
  referenceImageUrl?: string
  /** 黑色保留、白色重绘；尺寸须与参考图一致。 */
  maskImageUrl?: string
  /** 将小范围遮罩连同周边画面放大后重绘，再贴回原图。 */
  focusedInpaint?: boolean
  /** 聚焦重绘时，遮罩外保留的上下文像素。 */
  inpaintContextPixels?: number
  /** 聚焦结果贴回原图时，遮罩内侧的最大渐变宽度；小选区自动缩短。 */
  inpaintFeatherPixels?: number
  preciseReference?: NovelAIPreciseReference
  strength: number
  noise: number
  characters: NovelAICharacterPrompt[]
  saveToTaskList?: boolean
}

/** 不含凭据及图片 Base64，request 可直接用于单张图片的参数回填。 */
export interface NovelAIGenerationSnapshot {
  version: 1
  request: NovelAIStudioGenerateRequest
  seed: number
  requestedSeed: number
  batchSize: number
  imageIndex: number
}

export interface CivitaiModelVersionSummary {
  id: number
  name: string
  baseModel: string
  supportsGeneration: boolean
  trainedWords: string[]
}

export interface CivitaiModelSummary {
  id: number
  name: string
  type: string
  creator?: string
  imageUrl?: string
  nsfw: boolean
  supportsGeneration: boolean
  versions: CivitaiModelVersionSummary[]
}

export interface CivitaiModelSearchResult {
  items: CivitaiModelSummary[]
  nextCursor?: string
}
