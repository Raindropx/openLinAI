export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_IMAGE_MODEL = 'gemini-nano-banana-2.1'

export const GEMINI_SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
] as const

export const GEMINI_SAFETY_THRESHOLDS = [
  'OFF',
  'BLOCK_NONE',
  'BLOCK_ONLY_HIGH',
  'BLOCK_MEDIUM_AND_ABOVE',
  'BLOCK_LOW_AND_ABOVE',
] as const

export type GeminiSafetyCategory = (typeof GEMINI_SAFETY_CATEGORIES)[number]
export type GeminiSafetyThreshold = (typeof GEMINI_SAFETY_THRESHOLDS)[number]
/** Omitted categories use the upstream model default. */
export type GeminiSafetySettings = Partial<Record<GeminiSafetyCategory, GeminiSafetyThreshold>>

export const GEMINI_SAFETY_LABELS: Record<GeminiSafetyCategory, string> = {
  HARM_CATEGORY_HARASSMENT: '骚扰攻击',
  HARM_CATEGORY_HATE_SPEECH: '仇恨歧视',
  HARM_CATEGORY_SEXUALLY_EXPLICIT: '色情露骨',
  HARM_CATEGORY_DANGEROUS_CONTENT: '危险行为',
}

/** Preserve version/preview suffixes from Google's model catalog. */
export function normalizeGeminiModel(model: string) {
  const id = model.trim().replace(/^models\//, '')
  if (!/^gemini-[a-zA-Z0-9._-]+$/.test(id))
    throw new Error('请输入 Gemini 模型 ID，如 gemini-nano-banana-2.1')
  return id
}

export function geminiApiBaseURL(baseURL: string) {
  const url = new URL(baseURL.trim())
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Gemini API 地址必须是没有查询参数的 HTTP(S) 基地址')
  const base = url.toString().replace(/\/+$/, '').replace(/\/openai$/, '')
  return /\/v1(?:beta)?$/.test(base) ? base : `${base}/v1beta`
}

export function geminiImageCapabilities(model: string) {
  const id = normalizeGeminiModel(model)
  const standard = /^gemini-2\.5-flash-image(?:-|$)/.test(id)
  const lite = /^gemini-3\.1-flash-lite-image(?:-|$)/.test(id)
  return {
    sizes: standard || lite ? ['1k'] : ['1k', '2k', '4k'],
    maxReferences: standard ? 3 : 14,
    ratios: [
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9',
      ...(/^gemini-(?:nano-banana-2\.1|3\.1-flash(?:-lite)?-image)(?:-|$)/.test(id)
        ? ['1:4', '4:1', '1:8', '8:1'] : []),
    ],
    // The original 2.5 image model does not accept imageSize.
    sendImageSize: !standard,
  }
}
