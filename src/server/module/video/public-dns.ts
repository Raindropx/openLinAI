import { request } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

export interface VideoDnsAddress {
  address: string
  family: number
}

/** Node may request an address list; both forms must return only the pinned IP. */
export function pinnedVideoLookup(address: VideoDnsAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ ...address }])
    else callback(null, address.address, address.family)
  }
}

// Bootstrap with fixed public IPs so the resolver itself cannot resolve to Fake-IP.
// TLS still verifies the resolver's hostname; redirects and credentials are never used.
const resolvers = [
  { hostname: 'cloudflare-dns.com', address: '1.1.1.1', path: '/dns-query' },
  { hostname: 'dns.google', address: '8.8.8.8', path: '/resolve' },
] as const
type DnsResolver = (typeof resolvers)[number]
interface DnsAnswer {
  name: string
  type: number
  data: string
  TTL?: number
}
interface DnsResponse {
  Status?: number
  TC?: boolean
  Question?: Array<{ name: string; type: number }>
  Answer?: DnsAnswer[]
}

const normalizeName = (value: string) => value.toLowerCase().replace(/\.$/, '')
export function parseVideoDnsAnswer(
  hostname: string,
  type: 1 | 28,
  data: DnsResponse,
) {
  if (
    data.Status !== 0 ||
    data.TC ||
    !data.Question?.some(
      (question) =>
        normalizeName(question.name) === normalizeName(hostname) &&
        question.type === type,
    )
  )
    throw new Error('加密 DNS 未返回有效响应')
  const answers = data.Answer || []
  const names = new Set([normalizeName(hostname)])
  for (let hop = 0; hop < 16; hop++) {
    const before = names.size
    for (const answer of answers)
      if (answer.type === 5 && names.has(normalizeName(answer.name)))
        names.add(normalizeName(answer.data))
    if (names.size === before) break
  }
  const records = answers.filter(
    (answer) => answer.type === type && names.has(normalizeName(answer.name)),
  )
  const family = type === 1 ? 4 : 6
  if (records.some((answer) => isIP(answer.data) !== family))
    throw new Error('加密 DNS 返回了无效 IP 地址')
  const ttls = answers
    .filter((answer) => names.has(normalizeName(answer.name)))
    .map((answer) =>
      typeof answer.TTL === 'number' && Number.isFinite(answer.TTL)
        ? Math.max(0, answer.TTL)
        : 0,
    )
  return {
    addresses: records.map((answer) => ({ address: answer.data, family })),
    ttl: Math.min(60, ...ttls),
  }
}

function queryDns(
  resolver: DnsResolver,
  hostname: string,
  type: 1 | 28,
  signal: AbortSignal,
): Promise<DnsResponse> {
  const url = new URL(`https://${resolver.hostname}${resolver.path}`)
  url.search = new URLSearchParams({
    name: hostname,
    type: String(type),
    edns_client_subnet: '0.0.0.0/0',
  }).toString()
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        signal,
        agent: false,
        headers: { Accept: 'application/dns-json' },
        lookup: pinnedVideoLookup({ address: resolver.address, family: 4 }),
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy()
          reject(new Error('加密 DNS 请求失败'))
          return
        }
        const chunks: Buffer[] = []
        let length = 0
        response.on('data', (chunk: Buffer) => {
          length += chunk.length
          if (length > 64 * 1024) {
            response.destroy(new Error('加密 DNS 响应超出限制'))
            return
          }
          chunks.push(chunk)
        })
        response.on('error', () => reject(new Error('加密 DNS 连接失败')))
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new Error('加密 DNS 响应无效'))
          }
        })
      },
    )
    req.on('error', () => reject(new Error('加密 DNS 连接失败')))
    req.end()
  })
}

const cache = new Map<
  string,
  { expiresAt: number; addresses: VideoDnsAddress[] }
>()
const pending = new Map<string, Promise<VideoDnsAddress[]>>()
export async function resolveVideoPublicDns(
  hostname: string,
): Promise<VideoDnsAddress[]> {
  hostname = normalizeName(hostname)
  const saved = cache.get(hostname)
  if (saved && saved.expiresAt > Date.now())
    return saved.addresses.map((address) => ({ ...address }))
  cache.delete(hostname)
  let operation = pending.get(hostname)
  if (!operation) {
    operation = (async () => {
      // Both resolvers are bounded by the same deadline; one outage does not prevent fallback.
      const signal = AbortSignal.timeout(8000)
      const results = await Promise.allSettled(
        resolvers.map(async (resolver) => {
          const answers = await Promise.allSettled(
            ([1, 28] as const).map(async (type) =>
              parseVideoDnsAnswer(
                hostname,
                type,
                await queryDns(resolver, hostname, type, signal),
              ),
            ),
          )
          const valid = answers.flatMap((answer) =>
            answer.status === 'fulfilled' ? [answer.value] : [],
          )
          const addresses = valid.flatMap((answer) => answer.addresses)
          if (!addresses.length) throw new Error('加密 DNS 未返回地址')
          return {
            addresses,
            ttl: Math.min(...valid.map((answer) => answer.ttl)),
          }
        }),
      )
      const first = results.find((result) => result.status === 'fulfilled')
      if (!first || first.status !== 'fulfilled')
        throw new Error(
          '检测到代理 Fake-IP，但无法取得真实公网地址；请检查后端网络或为该域名配置真实 DNS 解析',
        )
      const { addresses, ttl } = first.value
      if (ttl > 0) {
        if (cache.size >= 128) cache.delete(cache.keys().next().value!)
        cache.set(hostname, { addresses, expiresAt: Date.now() + ttl * 1000 })
      }
      return addresses
    })()
    pending.set(hostname, operation)
  }
  try {
    return (await operation).map((address) => ({ ...address }))
  } finally {
    if (pending.get(hostname) === operation) pending.delete(hostname)
  }
}
