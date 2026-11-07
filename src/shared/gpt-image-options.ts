import { z } from 'zod'
import { normalizeLaoZhangModel, usesLaoZhangImages } from './laozhang'

// Both the guide and API reference specify 2–16 frames (checked 2026-11-07).
export const GPT_IMAGE_GIF_MAX_FRAMES = 16
export const gptImageOptionsSchema = z.object({
  outputFormat: z.enum(['png', 'jpeg', 'webp', 'gif', 'svg']).optional(),
  complexity: z.enum(['low', 'medium', 'high']).optional(),
  svgModel: z.string().trim().max(200).optional(),
  frameCount: z.number().int().min(2).max(GPT_IMAGE_GIF_MAX_FRAMES).optional(),
  frameDurationMs: z.number().int().min(20).max(2000).multipleOf(10).optional(),
})
export type GptImageOptions = z.infer<typeof gptImageOptionsSchema>

export function isGptImage26(model: string) {
  return /^(?:openai\/)?gpt-image-2\.6-(?:sunburst|flare)(?:-\d{4}-\d{2}-\d{2})?$/i.test(
    model,
  )
}

interface GptImageOptionsEndpoint {
  model: string
  editModel?: string
  baseURL: string
  engine?: string
}

function compatibleModelProvider(baseURL: string, model: string) {
  try {
    const { hostname } = new URL(baseURL)
    if (hostname === 'api.openlux.ai' && model === 'gpt-image-2.6-sunburst-c')
      return 'openlux'
    if (hostname === 'newapi.dragon3api.com' && model === 'gpt-image-2.6')
      return 'dragon'
  } catch {
    return
  }
}

/** The OpenAI and LaoZhang Images adapters forward these options. */
export function supportsGptImageOptions(
  endpoint: GptImageOptionsEndpoint,
  editing = false,
) {
  const model = editing ? endpoint.editModel || endpoint.model : endpoint.model
  if (usesLaoZhangImages(endpoint)) {
    const normalized = normalizeLaoZhangModel(model)
    return normalized.startsWith('gpt-image-') && isGptImage26(normalized)
  }
  if (endpoint.engine && endpoint.engine !== 'openai-images') return false
  return (
    isGptImage26(model) || Boolean(compatibleModelProvider(endpoint.baseURL, model))
  )
}

export function gptImageSvgRestriction(
  endpoint: GptImageOptionsEndpoint,
  editing: boolean,
) {
  if (editing && usesLaoZhangImages(endpoint))
    return '老张端点仅支持文生图输出 SVG'
  const model = editing ? endpoint.editModel || endpoint.model : endpoint.model
  if (compatibleModelProvider(endpoint.baseURL, model) === 'dragon')
    return '此 Dragon 模型的 SVG 请求会返回 PNG'
}

export function validateGptImageOptions(
  options: GptImageOptions | undefined,
  endpoint: GptImageOptionsEndpoint,
  imageCount: number,
  n = 1,
): string | undefined {
  if (!options || !Object.values(options).some((value) => value !== undefined))
    return
  if (!gptImageOptionsSchema.safeParse(options).success)
    return 'GPT Image 输出参数无效'
  if (!supportsGptImageOptions(endpoint, imageCount > 0))
    return '当前端点或模型不支持 GPT Image 2.6 输出参数'
  if (imageCount > 16) return 'GPT Image 最多支持 16 张参考图'
  if (options.outputFormat === 'svg') {
    const restriction = gptImageSvgRestriction(endpoint, imageCount > 0)
    if (restriction) return restriction
    if (n !== 1) return 'SVG 每次只能生成一张'
  }
  if (options.outputFormat !== 'svg' && options.svgModel?.trim())
    return 'SVG 作者模型仅适用于 SVG 输出'
  if (
    options.outputFormat !== 'gif' &&
    (options.frameCount !== undefined || options.frameDurationMs !== undefined)
  )
    return '动画参数仅适用于 GIF 输出'
}

export function gptImageRequestParams(options?: GptImageOptions) {
  return {
    ...(options?.outputFormat ? { output_format: options.outputFormat } : {}),
    ...(options?.complexity ? { complexity: options.complexity } : {}),
    ...(options?.outputFormat === 'svg' && options.svgModel?.trim()
      ? { svg: { model: options.svgModel.trim() } }
      : {}),
    ...(options?.outputFormat === 'gif'
      ? {
          frame_count: options.frameCount ?? 9,
          frame_duration_ms: options.frameDurationMs ?? 200,
          // The API chooses a valid per-frame size within its total pixel budget.
          size: 'auto' as const,
        }
      : {}),
  }
}
