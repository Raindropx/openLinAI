import crypto from 'crypto'
import { listVeniceModels, VeniceModelType } from './venice/models'
import { fetchWithTimeout } from './utils/fetch'

export type ModelCatalogType =
  | 'openai'
  | 'openai-image'
  | 'openai-image-generation'
  | 'openai-image-edit'
  | 'openai-vision-text'
  | 'openrouter-images'
  | 'novelai-image'
  | 'venice-text'
  | 'venice-vision-text'
  | 'venice-image'
  | 'venice-inpaint'

export interface ModelCatalogItem {
  id: string
  name: string
  type?: string
  privacy?: string
  constraints?: unknown
  supportedEndpoints?: string[]
}

interface CachedCatalog {
  expiresAt: number
  models: ModelCatalogItem[]
}

interface CompatibleModelRecord {
  model: ModelCatalogItem
  metadata: Record<string, unknown>
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const modelCache = new Map<string, CachedCatalog>()

function normalizeBaseURL(value: string) {
  const normalized = value.trim().replace(/\/+$/, '')
  const url = new URL(normalized)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('模型目录只支持 HTTP(S) API 地址')
  }
  return normalized
}

function parseJson(text: string): unknown {
  let parsed: unknown = JSON.parse(text)
  // 部分 New API 站点会把 JSON 再编码成字符串，兼容这种响应。
  if (typeof parsed === 'string') parsed = JSON.parse(parsed)
  return parsed
}

function getErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== 'object') return fallback
  const error = (data as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  const message = (data as { message?: unknown }).message
  return typeof message === 'string' ? message : fallback
}

function parseCompatibleModels(data: unknown): CompatibleModelRecord[] {
  const root = data as
    | { data?: unknown; models?: unknown }
    | unknown[]
    | undefined
  const items = Array.isArray(root)
    ? root
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.models)
        ? root.models
        : []

  const seen = new Set<string>()
  const models: CompatibleModelRecord[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const record = item as {
      id?: unknown
      name?: unknown
      model_name?: unknown
      model_spec?: { name?: unknown }
    }
    const id =
      typeof record.id === 'string'
        ? record.id.trim()
        : typeof record.model_name === 'string'
          ? record.model_name.trim()
          : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name =
      typeof record.name === 'string'
        ? record.name
        : typeof record.model_spec?.name === 'string'
          ? record.model_spec.name
          : id
    const metadata = item as Record<string, unknown>
    models.push({
      model: {
        id,
        name,
        supportedEndpoints: stringArray(
          metadata.supported_endpoints || metadata.supported_endpoint_types,
        ),
      },
      metadata,
    })
  }
  return models
}

function getVeniceType(catalog: ModelCatalogType): VeniceModelType | undefined {
  if (!catalog.startsWith('venice-')) return undefined
  if (catalog === 'venice-vision-text') return 'text'
  return catalog.slice('venice-'.length) as VeniceModelType
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function normalizedText(value: unknown) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function getArchitecture(metadata: Record<string, unknown>) {
  const architecture =
    metadata.architecture && typeof metadata.architecture === 'object'
      ? (metadata.architecture as Record<string, unknown>)
      : {}
  return {
    input: stringArray(
      architecture.input_modalities || metadata.input_modalities,
    ).map((item) => item.toLowerCase()),
    output: stringArray(
      architecture.output_modalities || metadata.output_modalities,
    ).map((item) => item.toLowerCase()),
  }
}

function getSupportedEndpointTypes(metadata: Record<string, unknown>) {
  return stringArray(
    metadata.supported_endpoints || metadata.supported_endpoint_types,
  ).map((item) => item.toLowerCase())
}

function isImageOutputModel(record: CompatibleModelRecord) {
  const { model, metadata } = record
  const architecture = getArchitecture(metadata)
  if (architecture.output.length > 0) {
    return architecture.output.includes('image')
  }

  const modelType = normalizedText(metadata.model_type)
  const tags = normalizedText(metadata.tags)
  const endpoints = getSupportedEndpointTypes(metadata).join(',')
  if (/图像|图片|绘画|image/.test(modelType)) return true
  if (/图像|图片|绘画|image generation/.test(tags)) return true
  if (/image-generation|image edit|绘图|编辑/.test(endpoints)) return true

  return /(^|[/:_-])(gpt-image|dall-e|imagen|gemini[^/]*image|qwen[^/]*(image|edit)|flux|recraft|seedream|ideogram|midjourney|nano-banana|grok-imagine|muse-image|stable-diffusion|sdxl|hidream|playground|inpaint)([/:_.-]|$)/i.test(
    model.id,
  )
}

function supportsImageOperation(
  record: CompatibleModelRecord,
  operation: 'generation' | 'edit',
) {
  if (!isImageOutputModel(record)) return false
  const endpoints = getSupportedEndpointTypes(record.metadata)
  if (endpoints.length === 0) return true
  const expected =
    operation === 'generation' ? '/v1/images/generations' : '/v1/images/edits'
  return endpoints.some(
    (endpoint) =>
      endpoint === expected ||
      (operation === 'generation'
        ? /images?[-_ ]?generations?/.test(endpoint)
        : /images?[-_ ]?edits?/.test(endpoint)),
  )
}

const NOVELAI_IMAGE_MODELS: ModelCatalogItem[] = [
  { id: 'nai-diffusion-5-full', name: 'NovelAI Diffusion V5 Full' },
  { id: 'nai-diffusion-5-curated', name: 'NovelAI Diffusion V5 Curated' },
  { id: 'nai-diffusion-4-5-full', name: 'NovelAI Diffusion V4.5 Full' },
  { id: 'nai-diffusion-4-5-curated', name: 'NovelAI Diffusion V4.5 Curated' },
  { id: 'nai-diffusion-4-full', name: 'NovelAI Diffusion V4 Full' },
  {
    id: 'nai-diffusion-4-curated-preview',
    name: 'NovelAI Diffusion V4 Curated',
  },
]

function isVisionTextModel(record: CompatibleModelRecord) {
  const { model, metadata } = record
  if (isImageOutputModel(record)) return false

  const architecture = getArchitecture(metadata)
  if (architecture.input.length > 0 || architecture.output.length > 0) {
    return (
      architecture.input.includes('text') &&
      architecture.input.includes('image') &&
      architecture.output.includes('text')
    )
  }

  const tags = normalizedText(metadata.tags)
  if (/识图|视觉理解|多模态|vision/.test(tags)) return true

  const capabilities =
    metadata.capabilities && typeof metadata.capabilities === 'object'
      ? (metadata.capabilities as Record<string, unknown>)
      : undefined
  if (capabilities?.supportsVision === true) return true

  const endpoints = getSupportedEndpointTypes(metadata)
  if (endpoints.length > 0 && !endpoints.includes('openai')) return false

  // 标准 OpenAI Model 对象没有模态字段。这里只保留已知视觉文本系列；
  // 未命中的自定义模型仍可在前端直接手动输入。
  return /(^|[/:_-])(gpt-(4o|4\.1|5(?:[0-9])?)|o[134]|gemini-|claude-(3|4|5|sonnet|opus|haiku)|qwen[^/]*-vl|qwen3\.[5-9]|glm-[45]v|grok-(3|4)|pixtral|llama[^/]*vision|deepseek[^/]*vision)([/:_.-]|$)/i.test(
    model.id,
  )
}

async function getProviderModelMetadata(baseURL: string) {
  const url = new URL(baseURL)
  if (!['api.openlux.ai', 'newapi.dragon3api.com'].includes(url.hostname)) {
    return new Map<string, Record<string, unknown>>()
  }

  try {
    const response = await fetchWithTimeout(
      `${url.origin}/api/pricing`,
      { headers: { Accept: 'application/json' } },
      10000,
    )
    if (!response.ok) return new Map<string, Record<string, unknown>>()
    const data = parseJson(await response.text()) as { data?: unknown }
    const items = Array.isArray(data?.data) ? data.data : []
    return new Map(
      items.flatMap((item): Array<[string, Record<string, unknown>]> => {
        if (!item || typeof item !== 'object') return []
        const metadata = item as Record<string, unknown>
        const id =
          typeof metadata.model_name === 'string'
            ? metadata.model_name.trim()
            : ''
        return id ? [[id, metadata]] : []
      }),
    )
  } catch {
    return new Map<string, Record<string, unknown>>()
  }
}

export async function listModelCatalog(options: {
  catalog: ModelCatalogType
  baseURL: string
  apiKey: string
}): Promise<ModelCatalogItem[]> {
  const { catalog, apiKey } = options
  const baseURL = normalizeBaseURL(options.baseURL)
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex')
  const cacheKey = `${catalog}:${baseURL}:${keyHash}`
  const cached = modelCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.models

  const veniceType = getVeniceType(catalog)
  let models: ModelCatalogItem[]
  if (catalog === 'novelai-image') {
    models = NOVELAI_IMAGE_MODELS
  } else if (veniceType) {
    const veniceModels = await listVeniceModels({
      type: veniceType,
      baseURL,
      apiKey,
    })
    models = veniceModels.map((model) => ({
      id: model.id,
      name: model.model_spec?.name || model.id,
      type: model.type,
      privacy: model.model_spec?.privacy,
      constraints: model.model_spec?.constraints,
    }))
    if (catalog === 'venice-vision-text') {
      models = models.filter((model) => {
        const source = veniceModels.find((item) => item.id === model.id)
        return source?.model_spec?.capabilities?.supportsVision === true
      })
    }
  } else {
    const isOpenRouter = new URL(baseURL).hostname === 'openrouter.ai'
    const path =
      catalog === 'openrouter-images'
        ? '/images/models'
        : (catalog === 'openai-image' ||
              catalog === 'openai-image-generation' ||
              catalog === 'openai-image-edit') &&
            isOpenRouter
          ? '/models?output_modalities=image'
          : catalog === 'openai-vision-text' && isOpenRouter
            ? '/models?input_modalities=text%2Cimage&output_modalities=text'
            : '/models'
    const response = await fetchWithTimeout(
      `${baseURL}${path}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      20000,
    )
    const responseText = await response.text()
    let data: unknown = {}
    try {
      data = responseText ? parseJson(responseText) : {}
    } catch {
      if (response.ok) throw new Error('模型目录返回了无法解析的响应')
    }
    if (!response.ok) {
      throw new Error(
        getErrorMessage(data, `模型目录请求失败 (${response.status})`),
      )
    }
    let records = parseCompatibleModels(data)
    if (
      !isOpenRouter &&
      (catalog === 'openai-image' ||
        catalog === 'openai-image-generation' ||
        catalog === 'openai-image-edit' ||
        catalog === 'openai-vision-text')
    ) {
      const providerMetadata = await getProviderModelMetadata(baseURL)
      records = records.map((record) => ({
        ...record,
        metadata: {
          ...record.metadata,
          ...(providerMetadata.get(record.model.id) || {}),
        },
      }))
      records = records.filter(
        catalog === 'openai-image-generation'
          ? (record) => supportsImageOperation(record, 'generation')
          : catalog === 'openai-image-edit'
            ? (record) => supportsImageOperation(record, 'edit')
            : catalog === 'openai-image'
              ? isImageOutputModel
              : isVisionTextModel,
      )
    }
    models = records.map((record) => record.model)
    if (models.length === 0) {
      throw new Error(
        catalog === 'openai-image' ||
          catalog === 'openai-image-generation' ||
          catalog === 'openai-image-edit'
          ? '目录中未找到图片生成或编辑模型；仍可手动输入模型 ID'
          : catalog === 'openai-vision-text'
            ? '目录中未找到同时支持文本/图片输入、文本输出的模型；仍可手动输入模型 ID'
            : '模型目录未返回可用的模型 ID',
      )
    }
  }

  modelCache.set(cacheKey, {
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    models,
  })
  return models
}
