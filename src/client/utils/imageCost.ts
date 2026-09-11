/** Keep sub-cent charges visible instead of rounding every image up to $0.01. */
export function formatImageUsd(cost: number): string {
  if (cost > 0 && cost < 0.000001) return '<$0.000001'
  return '$' + cost.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00')
}

/** Compact card labels; tooltips retain the detailed amount. */
export function formatImageUsdLabel(cost: number): string {
  return '$' + cost.toFixed(3)
}

type ImageCurrency = 'USD' | 'CNY' | 'POLLEN' | 'ANLAS'

export function formatImageCost(
  cost: number,
  currency: ImageCurrency,
  compact = false,
): string {
  const amount = compact
    ? cost.toFixed(3)
    : cost.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00')
  if (currency === 'USD') return `$${amount}`
  if (currency === 'CNY') return `￥${amount}`
  return `${amount} ${currency === 'POLLEN' ? 'Pollen' : 'Anlas'}`
}

// Unmultiplied reference rates only. Unknown/per-image models have no token estimate.
export function estimateImageCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  groupRatio = 1,
) {
  const rates: Record<string, [number, number]> = {
    'gpt-image-1': [5, 40],
    'gpt-image-1-mini': [2, 8],
    'gpt-image-1.5': [5, 32],
    'gpt-image-2': [5, 30],
    'gpt-image-2.5-flare': [5, 30],
    'gpt-image-2.5-sunburst': [5, 30],
  }
  const rate = rates[model]
  if (
    !rate ||
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    !Number.isFinite(groupRatio) ||
    inputTokens < 0 ||
    outputTokens < 0 ||
    groupRatio < 0
  )
    return null
  return {
    input: (inputTokens * rate[0] * groupRatio) / 1_000_000,
    output: (outputTokens * rate[1] * groupRatio) / 1_000_000,
  }
}
