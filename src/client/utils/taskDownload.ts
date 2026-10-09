import type { TaskDownloadStatus } from '../../shared/task-download'
import { readStoredLanguage, t, translateError } from '../i18n'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const result = (await response.json()) as {
    success?: boolean
    data: T
    error?: string
  }
  if (!response.ok || !result.success)
    throw new Error(translateError(result.error || `HTTP ${response.status}`))
  return result.data
}

/** Use the browser download manager, without fetching the ZIP into a Blob. */
export async function downloadTaskZip(
  ids: string[],
  name: string,
  onProgress?: (status: TaskDownloadStatus) => void,
) {
  const { token } = await request<{ token: string }>('/api/task/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, name, language: readStoredLanguage() }),
  })
  return downloadPreparedZip(token, onProgress)
}

export async function downloadTaskBackup(
  downloadedTaskIds: string[],
  onProgress?: (status: TaskDownloadStatus) => void,
) {
  const { token } = await request<{ token: string }>(
    '/api/task/backup-stream',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadedTaskIds }),
    },
  )
  return downloadPreparedZip(token, onProgress)
}

async function downloadPreparedZip(
  token: string,
  onProgress?: (status: TaskDownloadStatus) => void,
) {
  const url = `/api/task/download/${encodeURIComponent(token)}`
  const link = document.createElement('a')
  link.href = url
  link.download = ''
  document.body.appendChild(link)
  // A native download must outlive the page's progress polling. Removing a
  // hidden iframe later could abort a download still draining through a proxy.
  link.click()
  link.remove()
  const startedAt = Date.now()
  while (true) {
    const status = await request<TaskDownloadStatus>(`${url}/status`)
    onProgress?.(status)
    if (status.state === 'completed') return
    if (status.state === 'failed')
      throw new Error(translateError(status.error || t('下载已中断，请重试')))
    if (status.state === 'ready' && Date.now() - startedAt > 60000)
      throw new Error(t('下载未开始，请检查浏览器是否拦截下载后重试'))
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}
