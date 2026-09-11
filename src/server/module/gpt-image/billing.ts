/** A snapshot of the provider's bill, never recomputed using today's prices. */
export interface ImageBilling {
  status: 'pending' | 'actual' | 'estimated' | 'unavailable'
  currency: 'USD' | 'CNY' | 'POLLEN' | 'ANLAS'
  requestIds: string[]
  source?: 'provider-log' | 'provider-response' | 'model-pricing'
  note?: string
  /** Configured New API group ratio used only for fallback estimation. */
  estimatedGroupRatio?: number
  quota?: number
  cost?: number
  entries?: Array<{
    requestId: string
    group?: string
    groupRatio?: number
    quota: number
  }>
}

export function createEstimatedImageBilling(options: {
  currency: ImageBilling['currency']
  cost: number
  note: string
}): ImageBilling | undefined {
  if (!Number.isFinite(options.cost) || options.cost < 0) return undefined
  return {
    status: 'estimated',
    currency: options.currency,
    requestIds: [],
    source: 'model-pricing',
    cost: options.cost,
    note: options.note,
  }
}

interface ProviderImageUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost?: number
}

function readNonNegativeNumber(value: unknown): number | undefined {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

/**
 * Combine successful provider responses without inventing a zero-dollar bill.
 * The cost is exact only when every response explicitly includes usage.cost.
 */
export function summarizeProviderImageUsage(
  usages: Array<Record<string, unknown> | undefined>,
): { usage?: ProviderImageUsage; billing?: ImageBilling } {
  if (!usages.length) return {}
  const records = usages.filter(
    (usage): usage is Record<string, unknown> => usage !== undefined,
  )
  if (!records.length) return {}

  let hasCompleteCost = records.length === usages.length
  let totalCost = 0
  const usage: ProviderImageUsage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  }

  for (const record of records) {
    const input =
      readNonNegativeNumber(record.input_tokens ?? record.prompt_tokens) ?? 0
    const output =
      readNonNegativeNumber(record.output_tokens ?? record.completion_tokens) ??
      0
    const total = readNonNegativeNumber(record.total_tokens) ?? input + output
    usage.input_tokens += input
    usage.output_tokens += output
    usage.total_tokens += total

    const cost = readNonNegativeNumber(record.cost)
    if (cost === undefined) {
      hasCompleteCost = false
    } else {
      totalCost += cost
    }
  }

  if (!hasCompleteCost) return { usage }
  usage.cost = totalCost
  return {
    usage,
    billing: {
      status: 'actual',
      currency: 'USD',
      requestIds: [],
      source: 'provider-response',
      cost: totalCost,
    },
  }
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
    source: 'provider-log',
    quota,
    cost: quota / 500_000,
    entries,
  }
}

export async function fetchImageBill(options: {
  baseURL: string
  apiKey: string
  requestIds: string[]
  estimatedGroupRatio?: number
}): Promise<ImageBilling> {
  const unavailable: ImageBilling = {
    status: 'unavailable',
    currency: 'USD',
    requestIds: options.requestIds,
    estimatedGroupRatio: options.estimatedGroupRatio,
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
