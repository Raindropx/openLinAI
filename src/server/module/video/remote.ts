import { lookup } from 'node:dns/promises'
import type { IncomingMessage } from 'node:http'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, bits, 'ipv4')
// Only ordinary global-unicast IPv6 is accepted; reject mapped IPv4 and transition ranges.
blocked.addSubnet('2001::', 23, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')
blocked.addSubnet('3fff::', 20, 'ipv6')

export function isPublicVideoAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family === 6)
    return /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6')
  return false
}

export async function validateVideoUrl(
  raw: string,
  resolveAddresses = (hostname: string) =>
    lookup(hostname, { all: true, verbatim: true }),
) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('视频结果地址无效')
  }
  const hosts = (process.env.VIDEO_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !hosts.includes(url.hostname.toLowerCase()) ||
    isIP(url.hostname.replace(/^\[|\]$/g, ''))
  )
    throw new Error('视频地址必须使用 HTTPS 和已配置的服务商域名')
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await resolveAddresses(url.hostname)
  } catch {
    throw new Error('视频域名解析失败')
  }
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicVideoAddress(address))
  )
    throw new Error('视频地址指向禁止访问的网络')
  return { url, address: addresses[0] }
}

/** Resolve/check every redirect and pin the checked address on the actual TLS connection. */
export interface VideoRangeRequest {
  offset: number
  etag: string
}

export async function openRemoteVideo(
  raw: string,
  signal: AbortSignal,
  range?: VideoRangeRequest,
  redirects = 0,
): Promise<IncomingMessage> {
  signal.throwIfAborted()
  const { url, address } = await validateVideoUrl(raw)
  signal.throwIfAborted()
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        signal,
        headers: {
          Accept: 'video/mp4, video/webm',
          'Accept-Encoding': 'identity',
          ...(range
            ? { Range: `bytes=${range.offset}-`, 'If-Range': range.etag }
            : {}),
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
      },
      resolve,
    )
    req.setTimeout(30000, () => req.destroy(new Error('视频传输超时')))
    req.on('error', () =>
      reject(new Error(signal.aborted ? '视频传输已停止' : '视频连接失败')),
    )
    req.end()
  })
  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
    const location = response.headers.location
    response.destroy()
    if (!location || redirects >= 4) throw new Error('视频重定向无效或过多')
    return openRemoteVideo(
      new URL(location, raw).href,
      signal,
      range,
      redirects + 1,
    )
  }
  // The retrieval worker validates 206 and handles 416 by restarting, never appending blindly.
  if (range && response.statusCode === 416) return response
  if (response.statusCode !== 200 && !(range && response.statusCode === 206)) {
    const status = response.statusCode
    response.destroy()
    throw new Error(`云端视频读取失败 (HTTP ${status})`)
  }
  const mime = response.headers['content-type']
    ?.split(';')[0]
    .trim()
    .toLowerCase()
  if (
    (mime !== 'video/mp4' && mime !== 'video/webm') ||
    (response.headers['content-encoding'] &&
      response.headers['content-encoding'] !== 'identity')
  ) {
    response.destroy()
    throw new Error('云端响应不是支持的 MP4/WebM 视频')
  }
  return response
}
