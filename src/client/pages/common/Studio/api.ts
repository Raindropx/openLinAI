import {
  STUDIO_MAX_FILE_BYTES,
  type StudioItem,
} from '../../../../shared/studio'

export async function studioRequest<T>(
  route: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/studio${route}`, init)
  const result = await response.json()
  if (!response.ok || !result.success)
    throw new Error(result.error || '工作室请求失败')
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
