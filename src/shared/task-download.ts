export interface DownloadFileInfo {
  url: string
  fileName: string
  id: string
  endpointName?: string
  createdAt: number
  folder?: string
}

const safePart = (value: string, fallback: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .slice(0, 30) || fallback

export const formatTaskTimestamp = (createdAt: number) => {
  const d = new Date(createdAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `_${String(d.getMilliseconds()).padStart(3, '0')}`
  )
}

export const getTaskDownloadName = (
  fileName: string,
  endpointName: string | undefined,
  createdAt: number,
  unknownEndpoint = '未知端点',
) =>
  `${safePart(fileName, 'task')}_${safePart(endpointName || '', unknownEndpoint)}_${formatTaskTimestamp(createdAt)}`

export const getDownloadExtension = (url: string) =>
  url.split(/[?#]/)[0].match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'png'

export const getDownloadArchivePaths = (
  files: DownloadFileInfo[],
  unknownEndpoint = '未知端点',
) => {
  const used = new Set<string>()
  return files.map((file) => {
    const folder = file.folder
      ?.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
    const prefix = folder ? `${folder}/` : ''
    const name = getTaskDownloadName(
      file.fileName,
      file.endpointName,
      file.createdAt,
      unknownEndpoint,
    )
    const ext = getDownloadExtension(file.url)
    let archivePath = `${prefix}${name}.${ext}`
    let suffix = 2
    while (used.has(archivePath.toLowerCase()))
      archivePath = `${prefix}${name}_${suffix++}.${ext}`
    used.add(archivePath.toLowerCase())
    return archivePath
  })
}

export interface TaskDownloadStatus {
  state: 'ready' | 'running' | 'completed' | 'failed'
  completedFiles: number
  totalFiles: number
  error?: string
}
