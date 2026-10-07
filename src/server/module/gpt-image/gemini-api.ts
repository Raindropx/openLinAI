import fs from 'fs-extra'
import {
  geminiApiBaseURL,
  geminiImageCapabilities,
  GEMINI_SAFETY_CATEGORIES,
  GEMINI_SAFETY_LABELS,
  GEMINI_SAFETY_THRESHOLDS,
  normalizeGeminiModel,
  type GeminiSafetySettings,
} from '../../../shared/gemini'
import { fetchWithTimeout } from '../utils/fetch'
import type { GptImageSize } from './enum'
import { decodeImageBase64, getImageMimeType } from './image-files'

export interface GeminiImageRequestOptions {
  baseURL: string
  apiKey: string
  model: string
  prompt: string
  aspectRatio: string
  size: GptImageSize
  imagePaths: string[]
  geminiSafetySettings?: GeminiSafetySettings
}

export class GeminiApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'GeminiApiError'
  }
}

/** Native REST uses an API-key header; never put the key in the URL or follow redirects. */
export async function requestGeminiJson(
  url: string,
  apiKey: string,
  body?: unknown,
  timeoutMs = 20000,
): Promise<any> {
  const key = apiKey.trim()
  if (!key) throw new GeminiApiError('Gemini API Key 未配置', 400)
  const response = await fetchWithTimeout(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      'x-goog-api-key': key,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  }, timeoutMs)
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message : `Gemini API 请求失败 (${response.status})`
    throw new GeminiApiError(message.split(key).join('[redacted]'), response.status)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new GeminiApiError('Gemini API 返回了无法解析的响应', 502)
  return payload
}

export async function buildGeminiImageRequest(options: GeminiImageRequestOptions) {
  const safetySettings: Array<{ category: string; threshold: string }> = []
  for (const [category, threshold] of Object.entries(options.geminiSafetySettings || {})) {
    if (
      !GEMINI_SAFETY_CATEGORIES.some((item) => item === category) ||
      !GEMINI_SAFETY_THRESHOLDS.some((item) => item === threshold)
    )
      throw new GeminiApiError('Gemini 安全过滤设置无效，请重新选择过滤等级并保存', 400)
    safetySettings.push({ category, threshold })
  }
  const model = normalizeGeminiModel(options.model)
  const capabilities = geminiImageCapabilities(model)
  if (!capabilities.sizes.includes(options.size))
    throw new GeminiApiError(`Gemini 模型 ${model} 仅支持 1K 分辨率`, 400)
  if (options.aspectRatio !== 'auto' && !capabilities.ratios.includes(options.aspectRatio))
    throw new GeminiApiError(`Gemini 模型 ${model} 不支持比例 ${options.aspectRatio}`, 400)
  if (options.imagePaths.length > capabilities.maxReferences)
    throw new GeminiApiError(`该 Gemini 模型最多使用 ${capabilities.maxReferences} 张参考图`, 400)
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [
    { text: options.prompt },
  ]
  const requestLimit = 20 * 1000 * 1000
  const fileSizes = await Promise.all(options.imagePaths.map(async (filename) => (await fs.stat(filename)).size))
  if (fileSizes.reduce((sum, size) => sum + size, 0) * 4 / 3 >= requestLimit)
    throw new GeminiApiError('Gemini 请求超过 20 MB，请减少参考图数量或压缩图片', 400)
  for (const filename of options.imagePaths) {
    const mimeType = getImageMimeType(filename)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType))
      throw new GeminiApiError('Gemini 参考图请使用 PNG、JPEG 或 WebP', 400)
    const buffer = await fs.readFile(filename)
    parts.push({ inlineData: { mimeType, data: buffer.toString('base64') } })
  }
  const body = {
    contents: [{ role: 'user', parts }],
    ...(safetySettings.length ? { safetySettings } : {}),
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        ...(options.aspectRatio === 'auto' ? {} : { aspectRatio: options.aspectRatio }),
        ...(capabilities.sendImageSize ? { imageSize: options.size.toUpperCase() } : {}),
      },
    },
  }
  // generateContent inline requests must stay below Google's 20 MB request limit.
  if (Buffer.byteLength(JSON.stringify(body)) >= requestLimit)
    throw new GeminiApiError('Gemini 请求超过 20 MB，请减少参考图数量或压缩图片', 400)
  return {
    url: `${geminiApiBaseURL(options.baseURL)}/models/${encodeURIComponent(model)}:generateContent`,
    body,
  }
}

function geminiNoImageMessage(reason: unknown, ratings?: any[]) {
  if (typeof reason !== 'string') return 'Gemini 未返回图片'
  if (['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_PROHIBITED_CONTENT', 'BLOCKLIST'].includes(reason)) {
    const categories = Array.isArray(ratings)
      ? ratings.filter((rating) => rating?.blocked === true)
        .map((rating) => GEMINI_SAFETY_LABELS[rating.category as keyof typeof GEMINI_SAFETY_LABELS])
        .filter(Boolean)
      : []
    const detail = categories.length ? `，涉及：${[...new Set(categories)].join('、')}` : ''
    return `Google 的安全检查拦截了本次生成${detail}。请调整提示词或参考图；部分内置保护无法通过过滤等级关闭。(${reason})`
  }
  if (reason === 'STOP') return 'Gemini 已结束生成，但没有返回图片。请调整提示词后再试。(STOP)'
  return `Gemini 未返回图片 (${reason})`
}

export function extractGeminiImageBuffers(payload: any): Buffer[] {
  const buffers: Buffer[] = []
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
  const blockReason = payload?.promptFeedback?.blockReason
  if (typeof blockReason === 'string' && blockReason !== 'BLOCK_REASON_UNSPECIFIED')
    throw new GeminiApiError(geminiNoImageMessage(blockReason, payload?.promptFeedback?.safetyRatings), 502)
  for (const candidate of candidates) {
    if (['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_PROHIBITED_CONTENT', 'BLOCKLIST'].includes(candidate?.finishReason))
      continue
    for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
      if (part?.thought === true) continue
      const inline = part?.inlineData || part?.inline_data
      const mime = inline?.mimeType || inline?.mime_type
      if (typeof inline?.data === 'string' && /^image\//.test(mime || ''))
        buffers.push(decodeImageBase64(inline.data))
    }
  }
  if (!buffers.length) {
    const candidate = candidates.find((item: any) =>
      ['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_PROHIBITED_CONTENT', 'BLOCKLIST'].includes(item?.finishReason),
    ) || candidates[0]
    throw new GeminiApiError(geminiNoImageMessage(candidate?.finishReason, candidate?.safetyRatings), 502)
  }
  return buffers
}

export async function generateGeminiImage(
  request: Awaited<ReturnType<typeof buildGeminiImageRequest>>,
  apiKey: string,
) {
  // One paid submission per requested image. Do not retry on HTTP/network/body failures.
  const payload = await requestGeminiJson(request.url, apiKey, request.body, 600000)
  const metadata = payload.usageMetadata
  return {
    buffers: extractGeminiImageBuffers(payload),
    responseId: typeof payload.responseId === 'string' ? payload.responseId : undefined,
    usage: metadata ? {
      input_tokens: metadata.promptTokenCount,
      output_tokens: (metadata.candidatesTokenCount || 0) + (metadata.thoughtsTokenCount || 0),
      total_tokens: metadata.totalTokenCount,
    } : undefined,
  }
}
