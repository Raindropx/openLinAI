import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { StoredVideoEndpoint } from '../../common/video-endpoint-settings'
import { validateVideoUrl } from './remote'

const local = new BlockList()
for (const [address, bits] of [
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
] as const)
  local.addSubnet(address, bits, 'ipv4')
local.addAddress('::1', 'ipv6')
local.addSubnet('fc00::', 7, 'ipv6')

export function isLocalVideoAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return local.check(address, 'ipv4')
  if (family !== 6) return false
  const normalized = new URL(`http://[${address}]/`).hostname
  return (
    (normalized === '[::1]' || /^\[f[cd]/i.test(normalized)) &&
    local.check(address, 'ipv6')
  )
}

/** Local permission is confined to the saved API origin and path, never CDN URLs. */
export async function validateVideoApiTarget(
  endpoint: Pick<StoredVideoEndpoint, 'baseURL' | 'network'>,
  route: string,
  resolveAddresses = (hostname: string) =>
    lookup(hostname, { all: true, verbatim: true }),
) {
  const base = new URL(endpoint.baseURL.replace(/\/+$/, '') + '/')
  const target = new URL(endpoint.baseURL.replace(/\/+$/, '') + route)
  if (
    !route.startsWith('/') ||
    route.startsWith('//') ||
    target.origin !== base.origin ||
    !target.pathname.startsWith(base.pathname) ||
    target.username ||
    target.password ||
    target.hash ||
    !['http:', 'https:'].includes(target.protocol)
  )
    throw new Error('视频 API 请求超出配置的地址范围')
  if (endpoint.network !== 'local')
    return validateVideoUrl(target.href, resolveAddresses, [base.hostname])
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  let addresses
  try {
    addresses = family
      ? [{ address: hostname, family }]
      : await resolveAddresses(hostname)
  } catch {
    throw new Error('内网视频地址解析失败')
  }
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isLocalVideoAddress(address))
  )
    throw new Error(
      '内网视频端点只允许本机、私有局域网或 Tailscale 地址；不允许公网、链路本地或 Fake-IP',
    )
  return { url: target, address: addresses[0] }
}
