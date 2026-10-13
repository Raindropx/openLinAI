import { fetchWithTimeout } from '../utils/fetch'

export async function fetchNovelAIAnlas(baseURL: string, apiKey: string) {
  const response = await fetchWithTimeout(
    `${baseURL.replace(/\/+$/, '')}/user/subscription`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` } },
    15000,
  )
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = typeof data?.error === 'string'
      ? data.error
      : typeof data?.message === 'string' ? data.message : ''
    throw new Error(detail || `NovelAI 余额读取失败 (${response.status})`)
  }
  const fixed = data?.trainingStepsLeft?.fixedTrainingStepsLeft
  const purchased = data?.trainingStepsLeft?.purchasedTrainingSteps
  if (typeof fixed !== 'number' || typeof purchased !== 'number' ||
    !Number.isFinite(fixed) || !Number.isFinite(purchased) ||
    !Number.isFinite(fixed + purchased)) {
    throw new Error('NovelAI 余额响应格式不正确')
  }
  return fixed + purchased
}
