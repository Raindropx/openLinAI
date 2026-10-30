import type { IncomingMessage } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request } from 'node:https'
import type { StoredVideoEndpoint } from '../../common/video-endpoint-settings'
import { validateVideoApiTarget } from './endpoint-network'
import { pinnedVideoLookup } from './public-dns'
import { openRemoteVideo, type VideoRangeRequest } from './remote'

export type Json = Record<string, any>
export async function videoApiResponse(
  endpoint: StoredVideoEndpoint,
  route: string,
  signal: AbortSignal,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<IncomingMessage> {
  const { url: target, address } = await validateVideoApiTarget(endpoint, route)
  const multipart = body instanceof FormData ? new Response(body) : undefined
  const payload = multipart
    ? Buffer.from(await multipart.arrayBuffer())
    : body === undefined
      ? undefined
      : JSON.stringify(body)
  if (payload && Buffer.byteLength(payload) > 48 * 1024 * 1024)
    throw new Error('视频参考图总大小超出 48 MiB 请求限制')
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const req = (target.protocol === 'http:' ? httpRequest : request)(
      target,
      {
        method: body === undefined ? 'GET' : 'POST',
        signal,
        headers: {
          Accept: 'application/json',
          ...(endpoint.apiKey
            ? endpoint.protocol === 'gemini'
              ? { 'x-goog-api-key': endpoint.apiKey }
              : { Authorization: `Bearer ${endpoint.apiKey}` }
            : {}),
          ...(payload
            ? {
                'Content-Type':
                  multipart?.headers.get('content-type') || 'application/json',
                'Content-Length': String(Buffer.byteLength(payload)),
              }
            : {}),
          ...extraHeaders,
        },
        lookup: pinnedVideoLookup(address),
      },
      resolve,
    )
    req.on('error', () =>
      reject(
        new Error(
          signal.aborted ? '视频请求已停止或超时' : '视频服务商连接失败',
        ),
      ),
    )
    req.setTimeout(300000, () => req.destroy(new Error('视频服务商请求超时')))
    req.end(payload)
  })
}
export async function readVideoJson(
  response: IncomingMessage,
  endpoint: StoredVideoEndpoint,
): Promise<Json> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response) {
    size += chunk.length
    if (size > 4 * 1024 * 1024) {
      response.destroy()
      throw new Error('视频 API 响应超过 4 MiB，仅接受任务元数据与视频链接')
    }
    chunks.push(Buffer.from(chunk))
  }
  let value: Json
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error(`视频 API 未返回 JSON (HTTP ${response.statusCode})`)
  }
  if (
    (response.statusCode || 500) >= 300 ||
    (value.code !== undefined && ![0, 200].includes(value.code))
  ) {
    const error =
      [
        value.error?.message,
        value.error,
        value.msg,
        value.message,
        value.detail,
      ].find((item) => typeof item === 'string') ||
      '请检查 Key、模型权限和请求参数'
    throw new Error(
      `视频 API (HTTP ${response.statusCode})：${(endpoint.apiKey
        ? String(error).split(endpoint.apiKey).join('[已隐藏]')
        : String(error)
      )
        .replace(/https?:\/\/\S+/g, '[链接]')
        .slice(0, 400)}`,
    )
  }
  return value
}
export async function videoApiJson(
  endpoint: StoredVideoEndpoint,
  route: string,
  signal: AbortSignal,
  body?: unknown,
  headers?: Record<string, string>,
) {
  return readVideoJson(
    await videoApiResponse(endpoint, route, signal, body, headers),
    endpoint,
  )
}
export async function videoApiMedia(
  endpoint: StoredVideoEndpoint,
  route: string,
  signal: AbortSignal,
  range?: VideoRangeRequest,
  body?: unknown,
): Promise<IncomingMessage> {
  const response = await videoApiResponse(endpoint, route, signal, body, {
    Accept: 'video/mp4,video/webm',
    'Accept-Encoding': 'identity',
    ...(range
      ? { Range: `bytes=${range.offset}-`, 'If-Range': range.etag }
      : {}),
  })
  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
    const location = response.headers.location
    response.destroy()
    if (!location) throw new Error('视频下载重定向无效')
    if (endpoint.network === 'local')
      throw new Error('内网视频下载不接受重定向，请使用实际服务地址')
    // Credentials never follow a redirect to a CDN.
    return openRemoteVideo(
      new URL(location, endpoint.baseURL).href,
      signal,
      range,
    )
  }
  if (
    response.statusCode !== 200 &&
    response.statusCode !== 206 &&
    !(range && response.statusCode === 416)
  ) {
    response.destroy()
    throw new Error('服务商视频暂不可读取')
  }
  const mime = response.headers['content-type']?.split(';')[0]
  if (
    response.statusCode !== 416 &&
    !['video/mp4', 'video/webm'].includes(mime || '')
  ) {
    response.destroy()
    throw new Error('服务商未返回 MP4/WebM 视频流')
  }
  return response
}
