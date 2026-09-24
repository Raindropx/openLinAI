import {
  STUDIO_MAX_FILE_BYTES,
  type StudioItem,
} from '../../../../shared/studio'
import type {
  CivitaiModelSearchResult,
  NovelAIStudioGenerateRequest,
  StudioProviderSettings,
} from '../../../../shared/studio-generation'
import type { CivitaiGenerateRequest, CivitaiStudioJob } from '../../../../shared/civitai-generation'

export const estimateCivitaiGeneration = (data: CivitaiGenerateRequest) =>
  studioRequest<{ cost: number }>('/providers/civitai/estimate', studioJson('POST', data))
export const submitCivitaiGeneration = (id: string, request: CivitaiGenerateRequest) =>
  studioRequest<CivitaiStudioJob>('/providers/civitai/generate', studioJson('POST', { id, request }))
export const listCivitaiJobs = () => studioRequest<CivitaiStudioJob[]>('/providers/civitai/jobs')
export const pollCivitaiJob = (id: string) => studioRequest<CivitaiStudioJob>(`/providers/civitai/jobs/${encodeURIComponent(id)}`)

export async function studioRequest<T>(
  route: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/studio${route}`, init)
  const result = await response.json() as {
    success?: boolean
    data?: T
    error?: unknown
  }
  if (!response.ok || !result.success) {
    const fallback = `工作室请求失败 (HTTP ${response.status})`
    const error = result.error
    const objectMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message : undefined
    let issues = error && typeof error === 'object' && 'issues' in error
      ? (error as { issues?: unknown }).issues
      : undefined
    if (!Array.isArray(issues) && typeof objectMessage === 'string') {
      try { issues = JSON.parse(objectMessage) }
      catch { /* 普通错误信息不是 JSON */ }
    }
    const issue = Array.isArray(issues) ? issues[0] as { path?: unknown; message?: unknown } : undefined
    const path = Array.isArray(issue?.path) ? issue.path.join('.') : ''
    const detail = typeof issue?.message === 'string' ? issue.message : undefined
    const message = typeof error === 'string'
      ? error
      : detail ? `${path ? `${path}: ` : ''}${detail}`
        : typeof objectMessage === 'string' ? objectMessage : fallback
    throw new Error(message)
  }
  return result.data as T
}

export const studioJson = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})

export async function uploadStudioFile(file: File, documentId?: string) {
  if (file.size > STUDIO_MAX_FILE_BYTES) throw new Error('文件不能超过 64 MiB')
  const body = new FormData()
  body.append('file', file)
  if (documentId) body.append('documentId', documentId)
  return studioRequest<StudioItem>('/items', { method: 'POST', body })
}

export async function copyTaskImageToStudio(
  taskId: string,
  imageIndex: number,
) {
  const item = await studioRequest<StudioItem>(
    '/from-task',
    studioJson('POST', { taskId, imageIndex }),
  )
  window.dispatchEvent(new Event('studio-changed'))
  return item
}

export const getStudioProviderSettings = () =>
  studioRequest<StudioProviderSettings>('/providers')

export const updateNovelAISettings = (data: {
  apiKey?: string
  clearApiKey?: boolean
  model?: string
}) =>
  studioRequest<StudioProviderSettings>(
    '/providers/novelai',
    studioJson('PUT', data),
  )

export const updateCivitaiSettings = (data: {
  apiKey?: string
  clearApiKey?: boolean
}) =>
  studioRequest<StudioProviderSettings>(
    '/providers/civitai',
    studioJson('PUT', data),
  )

export const testStudioProvider = (provider: 'novelai' | 'civitai') =>
  studioRequest<{ connected: boolean; username?: string; anlas?: number }>(
    `/providers/${provider}/test`,
    { method: 'POST' },
  )

export const generateNovelAIStudioImages = (
  data: NovelAIStudioGenerateRequest,
) =>
  studioRequest<{ items: StudioItem[]; rawItems?: StudioItem[]; warning?: string }>(
    '/providers/novelai/generate',
    studioJson('POST', data),
  )

export async function uploadNovelAIMask(dataUrl: string) {
  const body = await (await fetch(dataUrl)).blob()
  return studioRequest<{ url: string }>('/providers/novelai/mask', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body,
  })
}

export const searchCivitaiModels = (data: {
  query?: string
  type?: string
  baseModel?: string
  sort?: string
  favorites?: boolean
  cursor?: string
  limit?: number
}) =>
  studioRequest<CivitaiModelSearchResult>(
    '/providers/civitai/models',
    studioJson('POST', data),
  )
