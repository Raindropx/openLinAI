/** APImart host detection keeps its protocol differences scoped to this provider. */
export function isAPIMartBaseURL(baseURL: string) {
  try {
    return new URL(baseURL).hostname === 'api.apimart.ai'
  } catch {
    return false
  }
}

export function unwrapAPIMartResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  return record.code === 200 && record.data && !Array.isArray(record.data)
    ? record.data
    : value
}
