import fs from 'fs-extra'
import path from 'path'
import {
  getLaoZhangImageFamily,
  isLaoZhangBaseURL,
  normalizeLaoZhangModel,
} from '../../../shared/laozhang'
import type { GptImageEndpoint } from '../../common/config'
import { fetchWithTimeout } from '../utils/fetch'
import type { GptImageQuality, GptImageSize } from './enum'
import { getImageMimeType, readImageAsDataUrl } from './image-files'

export interface LaoZhangImageRequestOptions {
  baseURL: string
  apiKey: string
  model: string
  prompt: string
  aspectRatio: string
  size: GptImageSize
  quality: GptImageQuality
  imagePaths: string[]
  laozhangGptImage2Mode?: GptImageEndpoint['laozhangGptImage2Mode']
  laozhangQuality?: GptImageEndpoint['laozhangQuality']
  laozhangTransparentBackground?: boolean
}

export function laoZhangApiRoot(baseURL: string) {
  const url = new URL(baseURL.trim())
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('老张 API 地址必须是没有查询参数的 HTTP(S) 基地址')
  return url
    .toString()
    .replace(/\/+$/, '')
    .replace(/\/(?:v1|v1beta)$/, '')
}

export function laoZhangImageSize(aspectRatio: string, size: GptImageSize) {
  if (aspectRatio === 'auto') return 'auto'
  const [w, h] = aspectRatio.split(':').map(Number)
  if (
    !(w > 0 && h > 0) ||
    !Number.isFinite(w / h) ||
    Math.max(w / h, h / w) > 3
  )
    throw new Error('GPT Image 的宽高比必须在 1:3 到 3:1 之间')
  const ratio = w / h
  const edge = size === '4k' ? 3840 : size === '2k' ? 2048 : 1024
  let width =
    size === '1k'
      ? ratio >= 1
        ? edge * ratio
        : edge
      : ratio >= 1
        ? edge
        : edge * ratio
  let height = width / ratio
  const scale = Math.min(
    1,
    3840 / Math.max(width, height),
    Math.sqrt(8294400 / (width * height)),
  )
  width = Math.floor((width * scale) / 16) * 16
  height = Math.floor((height * scale) / 16) * 16
  return `${width}x${height}`
}

export function laoZhangSeedreamSize(
  model: string,
  aspectRatio: string,
  size: GptImageSize,
) {
  const sizes: Record<string, GptImageSize[]> = {
    'seedream-5-0-flash-260915': ['1k', '2k'],
    'seedream-5-0-pro-260628': ['1k', '2k'],
    'seedream-5-0-260128': ['2k'],
    'seedream-4-5-251128': ['2k', '4k'],
    'seedream-4-0-250828': ['1k', '2k', '4k'],
  }
  if (!sizes[model]?.includes(size))
    throw new Error(
      `Seedream 模型 ${model} 不支持 ${size.toUpperCase()}，请调整分辨率`,
    )
  if (aspectRatio === 'auto') return size.toUpperCase()
  const [w, h] = aspectRatio.split(':').map(Number)
  const ratio = w / h
  if (
    !(w > 0 && h > 0) ||
    !Number.isFinite(ratio) ||
    ratio < 1 / 16 ||
    ratio > 16
  )
    throw new Error('Seedream 的宽高比必须在 1:16 到 16:1 之间')
  const edge = size === '1k' ? 1024 : size === '2k' ? 2048 : 4096
  // Area-based dimensions preserve the requested ratio and Seedream's pixel limits.
  return `${Math.floor(Math.sqrt(edge * edge * ratio) / 16) * 16}x${Math.floor(Math.sqrt((edge * edge) / ratio) / 16) * 16}`
}

export async function buildLaoZhangImageRequest(
  options: LaoZhangImageRequestOptions,
): Promise<{ url: string; init: RequestInit }> {
  const root = laoZhangApiRoot(options.baseURL)
  const model = normalizeLaoZhangModel(options.model)
  const family = getLaoZhangImageFamily(model)
  if (!family) throw new Error(`老张图片引擎尚不支持模型 ${model}`)
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    Accept: 'application/json',
  }
  const json = (url: string, body: unknown) => ({
    url,
    init: {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  })
  if (family === 'gemini') {
    const standard = model === 'gemini-2.5-flash-image'
    const lite = model === 'gemini-3.1-flash-lite-image'
    if ((standard || lite) && options.size !== '1k')
      throw new Error(
        '该 Nano Banana 模型只支持 1K，请选择 Nano Banana 2 或 Pro 生成 2K/4K',
      )
    if (options.imagePaths.length > (standard ? 3 : 14))
      throw new Error(
        `该 Nano Banana 模型最多使用 ${standard ? 3 : 14} 张参考图`,
      )
    const supportedRatios = [
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
      ...(model === 'gemini-3.1-flash-image'
        ? ['1:4', '4:1', '1:8', '8:1']
        : []),
    ]
    const ratio =
      (
        { '2:1': '16:9', '1:2': '9:16', '9:21': '9:16' } as Record<
          string,
          string
        >
      )[options.aspectRatio] || options.aspectRatio
    if (ratio !== 'auto' && !supportedRatios.includes(ratio))
      throw new Error(`该 Nano Banana 模型不支持比例 ${ratio}`)
    const parts: unknown[] = [{ text: options.prompt }]
    for (const filename of options.imagePaths)
      parts.push({
        inlineData: {
          mimeType: getImageMimeType(filename),
          data: (await fs.readFile(filename)).toString('base64'),
        },
      })
    return json(
      `${root}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            ...(ratio !== 'auto' ? { aspectRatio: ratio } : {}),
            ...(!standard ? { imageSize: options.size.toUpperCase() } : {}),
          },
        },
      },
    )
  }
  if (family === 'seedream') {
    if (options.imagePaths.length > 10)
      throw new Error('Seedream 最多使用 10 张参考图')
    const images = await Promise.all(options.imagePaths.map(readImageAsDataUrl))
    return json(`${root}/v1/images/generations`, {
      model,
      prompt: options.prompt,
      size: laoZhangSeedreamSize(model, options.aspectRatio, options.size),
      response_format: 'url',
      watermark: false,
      ...(images.length
        ? { image: images.length === 1 ? images[0] : images }
        : {}),
    })
  }
  if (family === 'grok') {
    if (options.size === '4k') throw new Error('Grok 2.0 仅支持 1K、2K')
    if (options.imagePaths.length > 3)
      throw new Error('Grok 2.0 最多使用 3 张参考图')
    const ratios = [
      '1:1',
      '16:9',
      '4:3',
      '3:2',
      '2:1',
      '19.5:9',
      '20:9',
      '21:9',
      '5:2',
      '9:16',
      '3:4',
      '2:3',
      '1:2',
      '9:19.5',
      '9:20',
    ]
    if (options.aspectRatio !== 'auto' && !ratios.includes(options.aspectRatio))
      throw new Error(`Grok 2.0 不支持比例 ${options.aspectRatio}`)
    const quality = options.laozhangQuality || 'medium'
    if (!['low', 'medium'].includes(quality))
      throw new Error('Grok 2.0 质量仅支持 low、medium')
    const body = {
      model,
      prompt: options.prompt,
      response_format: 'b64_json',
      ...(options.aspectRatio !== 'auto'
        ? { aspect_ratio: options.aspectRatio }
        : {}),
    }
    if (!options.imagePaths.length)
      return json(`${root}/v1/images/generations`, {
        ...body,
        n: 1,
        resolution: options.size,
        quality,
      })
    const form = new FormData()
    for (const [key, value] of Object.entries(body)) form.append(key, value)
    for (const filename of options.imagePaths)
      form.append(
        options.imagePaths.length === 1 ? 'image' : 'image[]',
        new Blob([new Uint8Array(await fs.readFile(filename))], {
          type: getImageMimeType(filename),
        }),
        path.basename(filename),
      )
    return {
      url: `${root}/v1/images/edits`,
      init: { method: 'POST', headers, body: form },
    }
  }
  if (options.imagePaths.length > 16)
    throw new Error('GPT Image 最多使用 16 张参考图')
  const perCallLegacy =
    model === 'gpt-image-2' && options.laozhangGptImage2Mode !== 'official'
  const quality = options.laozhangQuality || options.quality
  if (!model.startsWith('gpt-image-2.5-') && ['xhigh', 'max'].includes(quality))
    throw new Error('xhigh/max 仅适用于 GPT Image 2.5，请调整老张质量档位')
  if (
    options.laozhangTransparentBackground &&
    !/^gpt-image-2\.5-(flare|sunburst)-vip$/.test(model)
  )
    throw new Error('透明背景目前仅适配 GPT Image 2.5 Flare/Sunburst VIP')
  const body = {
    model,
    prompt: options.prompt,
    ...(!perCallLegacy
      ? {
          size: laoZhangImageSize(options.aspectRatio, options.size),
          ...(model !== 'gpt-image-2.5-web' ? { quality } : {}),
        }
      : {}),
    ...(options.laozhangTransparentBackground
      ? { background: 'transparent', output_format: 'png' }
      : {}),
  }
  if (!options.imagePaths.length)
    return json(`${root}/v1/images/generations`, body)
  const form = new FormData()
  for (const [key, value] of Object.entries(body)) form.append(key, value)
  for (const filename of options.imagePaths)
    form.append(
      options.imagePaths.length === 1 ? 'image' : 'image[]',
      new Blob([new Uint8Array(await fs.readFile(filename))], {
        type: getImageMimeType(filename),
      }),
      path.basename(filename),
    )
  return {
    url: `${root}/v1/images/edits`,
    init: { method: 'POST', headers, body: form },
  }
}

/** Normalize the two documented image response formats without treating text as images. */
export function extractLaoZhangImages(payload: any): string[] {
  const urls: string[] = []
  for (const item of Array.isArray(payload?.data) ? payload.data : []) {
    if (typeof item?.b64_json === 'string' && item.b64_json.trim())
      urls.push(
        item.b64_json.trim().startsWith('data:')
          ? item.b64_json.trim()
          : `data:image/png;base64,${item.b64_json}`,
      )
    else if (typeof item?.url === 'string' && /^https?:\/\//.test(item.url))
      urls.push(item.url)
  }
  for (const candidate of Array.isArray(payload?.candidates)
    ? payload.candidates
    : []) {
    for (const part of candidate?.content?.parts || []) {
      if (part.thought === true) continue
      const inline = part.inlineData || part.inline_data
      const mime = inline?.mimeType || inline?.mime_type
      if (typeof inline?.data === 'string' && /^image\//.test(mime || ''))
        urls.push(`data:${mime};base64,${inline.data}`)
    }
  }
  return urls
}

export async function generateLaoZhangImage(
  options: LaoZhangImageRequestOptions,
  builtRequest?: Awaited<ReturnType<typeof buildLaoZhangImageRequest>>,
) {
  const request = builtRequest || (await buildLaoZhangImageRequest(options))
  // Never retry a paid synchronous generation, including errors while reading the body.
  const response = await fetchWithTimeout(
    request.url,
    { ...request.init, signal: AbortSignal.timeout(600000), redirect: 'error' },
    600000,
  )
  const payload = await response.json().catch(() => {
    throw new Error(`老张返回了无法解析的响应 (${response.status})`)
  })
  if (!response.ok || payload?.error)
    throw new Error(
      payload?.error?.message ||
        (typeof payload?.error === 'string'
          ? payload.error
          : `老张请求失败 (${response.status})`),
    )
  const urls = extractLaoZhangImages(payload)
  if (!urls.length)
    throw new Error('老张未返回图片，请检查调用日志；重试会提交新的付费请求')
  return urls
}

export async function fetchLaoZhangBalance(
  baseURL: string,
  accessToken: string,
) {
  if (!isLaoZhangBaseURL(baseURL) || new URL(baseURL).protocol !== 'https:')
    throw new Error('老张余额查询仅支持官方 HTTPS 域名')
  if (!accessToken.trim())
    throw new Error(
      '请配置独立的老张系统 AccessToken；生图 API Key 不能查询账户余额',
    )
  const response = await fetchWithTimeout(
    `${new URL(baseURL).origin}/api/user/self`,
    {
      headers: {
        Authorization: accessToken.trim(),
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    },
    15000,
  )
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.success !== true)
    throw new Error(
      `老张余额查询失败 (${response.status})，请检查系统 AccessToken`,
    )
  const quota = payload?.data?.quota
  const used = payload?.data?.used_quota
  if (
    typeof quota !== 'number' ||
    !Number.isFinite(quota) ||
    quota < 0 ||
    typeof used !== 'number' ||
    !Number.isFinite(used) ||
    used < 0
  )
    throw new Error('老张余额响应未包含有效额度')
  return {
    total_available: quota / 500000,
    total_used: used / 500000,
    total_granted: (quota + used) / 500000,
  }
}
