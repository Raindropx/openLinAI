/** A snapshot of the provider's bill, never recomputed using today's prices. */
export interface ImageBilling {
  status: 'pending' | 'actual' | 'unavailable'
  currency: 'USD'
  requestIds: string[]
  quota?: number
  cost?: number
  entries?: Array<{
    requestId: string
    group?: string
    groupRatio?: number
    quota: number
  }>
}

export function getBillingRequestId(headers: Headers): string | undefined {
  return (
    headers.get('x-api-request-id') ||
    headers.get('x-oneapi-request-id') ||
    headers.get('x-request-id') ||
    undefined
  )
}

function parseOther(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return parseOther(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Never match on timestamp/token counts: concurrent requests can be identical. */
export function matchImageBill(
  payload: unknown,
  requestIds: string[],
): ImageBilling | null {
  if (!requestIds.length || new Set(requestIds).size !== requestIds.length)
    return null
  const body = payload as { success?: boolean; data?: unknown }
  if (!body || body.success !== true) return null
  const data = body.data as { items?: unknown } | undefined
  const logs = Array.isArray(data) ? data : data?.items
  if (!Array.isArray(logs)) return null
  const entries: NonNullable<ImageBilling['entries']> = []
  const usedLogs = new Set<unknown>()
  for (const requestId of requestIds) {
    const matches = logs.filter((log) => {
      if (!log || log.type !== 2) return false
      const other = parseOther(log.other)
      return [
        log.request_id,
        log.upstream_request_id,
        other.request_id,
      ].includes(requestId)
    })
    if (matches.length !== 1) return null
    const log = matches[0]
    if (usedLogs.has(log)) return null
    usedLogs.add(log)
    if (
      typeof log.quota !== 'number' ||
      !Number.isSafeInteger(log.quota) ||
      log.quota < 0
    )
      return null
    const other = parseOther(log.other)
    const ratio = other.group_ratio
    entries.push({
      requestId,
      quota: log.quota,
      group: typeof log.group === 'string' ? log.group : undefined,
      groupRatio:
        typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0
          ? ratio
          : undefined,
    })
  }
  const quota = entries.reduce((sum, entry) => sum + entry.quota, 0)
  if (!Number.isSafeInteger(quota)) return null
  return {
    status: 'actual',
    currency: 'USD',
    requestIds,
    quota,
    cost: quota / 500_000,
    entries,
  }
}

export async function fetchImageBill(options: {
  baseURL: string
  apiKey: string
  requestIds: string[]
}): Promise<ImageBilling> {
  const unavailable: ImageBilling = {
    status: 'unavailable',
    currency: 'USD',
    requestIds: options.requestIds,
  }
  if (!options.requestIds.length) return unavailable
  // Poll briefly for asynchronous log writes, without delaying the generated image.
  for (const delay of [0, 1500, 3500]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      const url = new URL(options.baseURL)
      url.search = ''
      url.hash = ''
      url.pathname =
        url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '') +
        '/api/log/token'
      // OpenLux's legacy endpoint requires the key query parameter. Keep it
      // server-side, HTTPS-only, and never log this URL or a fetch error.
      if (url.hostname === 'api.openlux.ai') {
        if (url.protocol !== 'https:') return unavailable
        url.searchParams.set('key', options.apiKey.replace(/^sk-/, ''))
      }
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) continue
      const result = matchImageBill(await response.json(), options.requestIds)
      if (result) return result
    } catch {
      // Billing is optional; an unavailable bill must not fail image generation.
    }
  }
  return unavailable
}
