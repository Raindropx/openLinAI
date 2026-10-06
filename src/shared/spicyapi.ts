export const SPICY_API_BASE_URL = 'https://api.spicyapi.ai/api/v1'
export const SPICY_SEEDREAM_MODEL = 'bytedance/seedream-5.0-flash/text-to-image'
export const SPICY_QWEN_LORA_MODEL = 'alibaba/qwen-image-2.1-lora/text-to-image'

export interface SpicyLora {
  path: string
  scale: number
}

export function spicyBaseURL(value: string) {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('SpicyAPI 地址必须使用 HTTP(S)')
  url.search = ''
  url.hash = ''
  const prefix = url.pathname.replace(/\/+$/, '').replace(/(?:\/api)?\/v1$/, '')
  url.pathname = `${prefix}/api/v1`
  return url.toString().replace(/\/+$/, '')
}
