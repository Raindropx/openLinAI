/** Public capability helpers shared by settings, model catalog and generation. */
export const LAOZHANG_BASE_URL = 'https://api.laozhang.ai/v1'
export const LAOZHANG_HOSTS = [
  'api.laozhang.ai',
  'api2.laozhang.ai',
  'api-vip.laozhang.ai',
]
export type LaoZhangQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type LaoZhangGptImage2Mode = 'per-call' | 'official'

export function isLaoZhangBaseURL(value: string) {
  try {
    return LAOZHANG_HOSTS.includes(new URL(value).hostname)
  } catch {
    return false
  }
}

export function normalizeLaoZhangModel(model: string) {
  return model
    .trim()
    .replace(/^google\//, '')
    .replace(/^(gemini-.+image)-preview$/, '$1')
}

export function getLaoZhangImageFamily(
  model: string,
): 'gpt' | 'gemini' | 'seedream' | 'grok' | undefined {
  const id = normalizeLaoZhangModel(model)
  if (/^gpt-image-(?:2(?:[.-]|$))/.test(id)) return 'gpt'
  if (
    [
      'gemini-2.5-flash-image',
      'gemini-3.1-flash-lite-image',
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
    ].includes(id)
  )
    return 'gemini'
  if (/^seedream-[45]-/.test(id)) return 'seedream'
  if (id === 'grok-imagine-image-2.0') return 'grok'
  return undefined
}

export function usesLaoZhangImages(endpoint: {
  baseURL: string
  engine?: string
  model: string
  editModel?: string
}) {
  return (
    endpoint.engine === 'laozhang-images' ||
    (isLaoZhangBaseURL(endpoint.baseURL) &&
      ['openai-images', 'chat-completions', undefined].includes(
        endpoint.engine,
      ) &&
      Boolean(
        getLaoZhangImageFamily(endpoint.model) ||
        getLaoZhangImageFamily(endpoint.editModel || ''),
      ))
  )
}
