import { saveAs } from 'file-saver'
import JSZip from 'jszip'

const getSafeFileName = (fileName: string) => {
  return fileName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)
}

const getExtension = (url: string) => {
  return url.split('.').pop() || 'png'
}

/**
 * 生成下载文件名后缀：可读时间戳 + 4 位随机，避免同名模板/空标题下载时重名。
 * 形如 _20260705_143052_a3f1。
 */
const getUniqueSuffix = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 6)
  return `${ts}_${rand}`
}

export const downloadFile = async (url: string, fileName: string) => {
  const response = await fetch(url)
  const blob = await response.blob()
  const safeName = getSafeFileName(fileName)
  const ext = getExtension(url)
  saveAs(blob, `${safeName}_${getUniqueSuffix()}.${ext}`)
}

/** 打压缩包下载的文件数量下限 */
export const DOWNLOAD_ZIP_MAX_FILES = 10

export const downloadFilesZip = async (
  files: { url: string; fileName: string; id: string }[],
  zipName: string,
) => {
  const zip = new JSZip()
  // 同一次批量打包内，多个文件共用一个时间戳，靠随机串区分；
  // 跨次打包则时间戳不同。
  const suffix = getUniqueSuffix()
  await Promise.all(
    files.map(async (file, index) => {
      try {
        const response = await fetch(file.url)
        const blob = await response.blob()
        const safeName = getSafeFileName(file.fileName)
        const ext = getExtension(file.url)
        zip.file(`${safeName}_${suffix}_${index}.${ext}`, blob)
      } catch (error) {
        console.error(`下载任务 ${file.id} 失败`, error)
      }
    }),
  )
  const content = await zip.generateAsync({ type: 'blob' })
  saveAs(content, `${zipName}.zip`)
}
