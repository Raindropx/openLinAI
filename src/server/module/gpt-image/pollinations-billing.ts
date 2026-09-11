import { fetchWithTimeout } from '../utils/fetch'
import { createEstimatedImageBilling, ImageBilling } from './billing'

interface PollinationsPricing {
  currency?: string
  promptTextTokens?: string | number
  promptImageTokens?: string | number
  completionImageTokens?: string | number
}

interface PollinationsModel {
  id?: string
  aliases?: string[]
  pricing?: PollinationsPricing
}

interface PollinationsUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: {
    text_tokens?: number
    image_tokens?: number
  }
}

interface CachedModels {
  expiresAt: number
  models: PollinationsModel[]
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const modelCache = new Map<string, CachedModels>()

function price(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

async function getModels(baseURL: string) {
  const normalized = baseURL.replace(/\/+$/, '')
  const cached = modelCache.get(normalized)
  if (cached && cached.expiresAt > Date.now()) return cached.models
  const response = await fetchWithTimeout(
    `${normalized}/models`,
    { headers: { Accept: 'application/json' } },
    15000,
  )
  if (!response.ok) throw new Error(`Pollinations 模型目录返回 ${response.status}`)
  const payload = (await response.json()) as { data?: unknown }
  const models = Array.isArray(payload.data)
    ? (payload.data as PollinationsModel[])
    : []
  modelCache.set(normalized, {
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    models,
  })
  return models
}

export async function estimatePollinationsImageBilling(options: {
  baseURL: string
  model: string
  usage: PollinationsUsage | undefined
  imageCount: number
}): Promise<ImageBilling | undefined> {
  try {
    const models = await getModels(options.baseURL)
    const model = models.find(
      (item) => item.id === options.model || item.aliases?.includes(options.model),
    )
    const pricing = model?.pricing
    if (pricing?.currency?.toLowerCase() !== 'pollen') return undefined

    const promptTextRate = price(pricing.promptTextTokens)
    const promptImageRate = price(pricing.promptImageTokens)
    const outputImageRate = price(pricing.completionImageTokens)
    const details = options.usage?.input_tokens_details
    const fixedPerImage =
      outputImageRate !== undefined &&
      promptTextRate === undefined &&
      promptImageRate === undefined
    const outputUnits = fixedPerImage
      ? options.imageCount
      : options.usage?.output_tokens
    if (
      (promptTextRate !== undefined && details?.text_tokens === undefined) ||
      (promptImageRate !== undefined && details?.image_tokens === undefined) ||
      (outputImageRate !== undefined && outputUnits === undefined)
    ) {
      return undefined
    }

    const cost =
      (promptTextRate || 0) * (details?.text_tokens || 0) +
      (promptImageRate || 0) * (details?.image_tokens || 0) +
      (outputImageRate || 0) * (outputUnits || 0)
    if (
      promptTextRate === undefined &&
      promptImageRate === undefined &&
      outputImageRate === undefined
    ) {
      return undefined
    }
    return createEstimatedImageBilling({
      currency: 'POLLEN',
      cost,
      note: fixedPerImage
        ? `生成时读取的 Pollinations 模型目录价格，按 ${options.imageCount} 张成功图片计算`
        : '生成时读取的 Pollinations 模型目录价格，按服务商返回的图片 tokens 计算',
    })
  } catch {
    return undefined
  }
}
