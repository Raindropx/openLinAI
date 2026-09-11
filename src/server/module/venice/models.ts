import crypto from 'crypto'
import { fetchWithTimeout } from '../utils/fetch'

export const VENICE_API_BASE_URL = 'https://api.venice.ai/api/v1'

export type VeniceModelType = 'text' | 'image' | 'inpaint'

export interface VeniceModelConstraints {
  promptCharacterLimit?: number
  aspectRatios?: string[]
  defaultAspectRatio?: string
  resolutions?: string[]
  defaultResolution?: string
  qualities?: string[]
  defaultQuality?: string
  maxInputImages?: number
  widthHeightDivisor?: number
}

export interface VenicePrice {
  usd?: number
  diem?: number
}

export interface VeniceModelPricing {
  generation?: VenicePrice
  inpaint?: VenicePrice
  resolutions?: Record<string, VenicePrice>
  quality?: Record<string, Record<string, VenicePrice>>
  inputImages?: {
    included?: number
    additional?: VenicePrice
  }
}

export interface VeniceModel {
  id: string
  type: string
  model_spec?: {
    name?: string
    offline?: boolean
    privacy?: string
    pricing?: VeniceModelPricing
    capabilities?: {
      supportsVision?: boolean
    }
    constraints?: VeniceModelConstraints
  }
}

interface VeniceModelsResponse {
  data?: VeniceModel[]
  error?: string | { message?: string }
  message?: string
}

interface ModelCacheEntry {
  expiresAt: number
  models: VeniceModel[]
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const modelCache = new Map<string, ModelCacheEntry>()

export function normalizeVeniceBaseURL(baseURL: string) {
  return baseURL.trim().replace(/\/+$/, '')
}

function getErrorMessage(data: VeniceModelsResponse, fallback: string) {
  if (typeof data.error === 'string') return data.error
  if (typeof data.error?.message === 'string') return data.error.message
  if (typeof data.message === 'string') return data.message
  return fallback
}

export async function listVeniceModels(options: {
  type: VeniceModelType
  baseURL?: string
  apiKey?: string
}): Promise<VeniceModel[]> {
  const baseURL = normalizeVeniceBaseURL(
    options.baseURL || VENICE_API_BASE_URL,
  )
  const credentialKey = options.apiKey
    ? crypto.createHash('sha256').update(options.apiKey).digest('hex')
    : 'public'
  const cacheKey = `${baseURL}:${options.type}:${credentialKey}`
  const cached = modelCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.models

  const response = await fetchWithTimeout(
    `${baseURL}/models?type=${encodeURIComponent(options.type)}`,
    {
      headers: options.apiKey
        ? { Authorization: `Bearer ${options.apiKey}` }
        : undefined,
    },
    15000,
  )
  const data: VeniceModelsResponse = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      getErrorMessage(data, `Venice 模型目录返回 ${response.status}`),
    )
  }

  const models = Array.isArray(data.data)
    ? data.data.filter(
        (model) =>
          typeof model?.id === 'string' && model.model_spec?.offline !== true,
      )
    : []
  modelCache.set(cacheKey, {
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    models,
  })
  return models
}

export async function getVeniceModel(options: {
  type: VeniceModelType
  model: string
  baseURL: string
  apiKey: string
}) {
  const models = await listVeniceModels(options)
  const found = models.find((item) => item.id === options.model)
  if (!found) {
    throw new Error(
      `Venice ${options.type} 模型目录中不存在或已下线：${options.model}`,
    )
  }
  return found
}
