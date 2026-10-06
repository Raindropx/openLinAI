import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import { t } from '../i18n'

const getSafeFileNamePart = (value: string, fallback: string) => {
  const safeValue = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 30)
  return safeValue || fallback
}

const getExtension = (url: string) => {
  return url.split('.').pop() || 'png'
}

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
) => {
  const safeFileName = getSafeFileNamePart(fileName, 'task')
  const safeEndpointName = getSafeFileNamePart(
    endpointName || '',
    t('未知端点'),
  )
  return `${safeFileName}_${safeEndpointName}_${formatTaskTimestamp(createdAt)}`
}

export interface DownloadFileInfo {
  url: string
  fileName: string
  id: string
  endpointName?: string
  createdAt: number
  folder?: string
}

export const downloadFile = async (file: DownloadFileInfo) => {
  const response = await fetch(file.url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  const downloadName = getTaskDownloadName(
    file.fileName,
    file.endpointName,
    file.createdAt,
  )
  const ext = getExtension(file.url)
  saveAs(blob, `${downloadName}.${ext}`)
}

/** 打压缩包下载的文件数量下限 */
export const DOWNLOAD_ZIP_MAX_FILES = 10

export const createFilesZip = async (files: DownloadFileInfo[]) => {
  const zip = new JSZip()
  const usedPaths = new Set<string>()
  const paths = files.map((file) => {
    // Folder names are validated by the API; also sanitize archive paths defensively.
    const folder = file.folder
      ?.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
    const name = getTaskDownloadName(
      file.fileName,
      file.endpointName,
      file.createdAt,
    )
    const ext = getExtension(file.url)
    const prefix = folder ? `${folder}/` : ''
    let path = `${prefix}${name}.${ext}`
    let suffix = 2
    while (usedPaths.has(path)) path = `${prefix}${name}_${suffix++}.${ext}`
    usedPaths.add(path)
    return path
  })
  await Promise.all(
    files.map(async (file, index) => {
      const response = await fetch(file.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = await response.arrayBuffer()
      zip.file(paths[index], bytes)
    }),
  )
  return zip.generateAsync({ type: 'blob' })
}

export const downloadFilesZip = async (
  files: DownloadFileInfo[],
  zipName: string,
) => {
  const content = await createFilesZip(files)
  saveAs(content, `${zipName}.zip`)
}
