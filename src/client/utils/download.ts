import { saveAs } from 'file-saver'
import JSZip from 'jszip'

const getSafeFileNamePart = (value: string, fallback: string) => {
  const safeValue = value.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)
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
    '未知端点',
  )
  return `${safeFileName}_${safeEndpointName}_${formatTaskTimestamp(createdAt)}`
}

export interface DownloadFileInfo {
  url: string
  fileName: string
  id: string
  endpointName?: string
  createdAt: number
}

export const downloadFile = async (file: DownloadFileInfo) => {
  const response = await fetch(file.url)
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

export const downloadFilesZip = async (
  files: DownloadFileInfo[],
  zipName: string,
) => {
  const zip = new JSZip()
  await Promise.all(
    files.map(async (file) => {
      try {
        const response = await fetch(file.url)
        const blob = await response.blob()
        const downloadName = getTaskDownloadName(
          file.fileName,
          file.endpointName,
          file.createdAt,
        )
        const ext = getExtension(file.url)
        zip.file(`${downloadName}.${ext}`, blob)
      } catch (error) {
        console.error(`下载任务 ${file.id} 失败`, error)
      }
    }),
  )
  const content = await zip.generateAsync({ type: 'blob' })
  saveAs(content, `${zipName}.zip`)
}
