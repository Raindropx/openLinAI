import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import {
  getDownloadArchivePaths,
  getDownloadExtension as getExtension,
  getTaskDownloadName as taskDownloadName,
  type DownloadFileInfo,
} from '../../shared/task-download'
import { t } from '../i18n'

export { formatTaskTimestamp } from '../../shared/task-download'
export type { DownloadFileInfo } from '../../shared/task-download'

export const getTaskDownloadName = (
  fileName: string,
  endpointName: string | undefined,
  createdAt: number,
) => taskDownloadName(fileName, endpointName, createdAt, t('未知端点'))

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

export const DOWNLOAD_CONCURRENCY = 4
export const DOWNLOAD_ZIP_PART_MAX_FILES = 100
export const DOWNLOAD_ZIP_PART_MAX_BYTES = 128 * 1024 * 1024

export interface DownloadProgress {
  completed: number
  total: number
  part: number
}

export const getDownloadErrorMessage = (error: unknown) =>
  t('下载失败：{0}', [error instanceof Error ? error.message : String(error)])

interface ZipPartOptions {
  maxFiles?: number
  maxBytes?: number
  onProgress?: (progress: DownloadProgress) => void
}

/** Yield each archive before loading the next, rather than retaining all images. */
export async function* createFilesZipParts(
  files: DownloadFileInfo[],
  {
    maxFiles = DOWNLOAD_ZIP_PART_MAX_FILES,
    maxBytes = DOWNLOAD_ZIP_PART_MAX_BYTES,
    onProgress,
  }: ZipPartOptions = {},
) {
  if (!(maxFiles >= 1) || !(maxBytes > 0))
    throw new Error('Invalid ZIP part limits')
  let zip = new JSZip()
  let count = 0
  let size = 0
  let completed = 0
  let part = 1
  const paths = getDownloadArchivePaths(files, t('未知端点'))
  for (let start = 0; start < files.length; start += DOWNLOAD_CONCURRENCY) {
    const controller = new AbortController()
    const pending = files
      .slice(start, start + DOWNLOAD_CONCURRENCY)
      .map(async (file, offset) => {
        try {
          const response = await fetch(file.url, { signal: controller.signal })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return { bytes: await response.arrayBuffer(), index: start + offset }
        } catch (error) {
          throw new Error(
            t('读取图片失败：{0}（{1}）', [
              paths[start + offset],
              error instanceof Error ? error.message : String(error),
            ]),
          )
        }
      })
    let batch: Awaited<(typeof pending)[number]>[]
    try {
      batch = await Promise.all(pending)
    } catch (error) {
      controller.abort()
      await Promise.allSettled(pending)
      throw error
    }
    for (const { bytes, index } of batch) {
      if (
        count > 0 &&
        (count >= maxFiles || size + bytes.byteLength > maxBytes)
      ) {
        yield {
          content: await zip.generateAsync({ type: 'blob', streamFiles: true }),
          part,
          isLast: false,
        }
        zip = new JSZip()
        count = 0
        size = 0
        part++
      }
      zip.file(paths[index], bytes)
      count++
      size += bytes.byteLength
      completed++
      onProgress?.({ completed, total: files.length, part })
    }
  }
  if (count > 0) {
    yield {
      content: await zip.generateAsync({ type: 'blob', streamFiles: true }),
      part,
      isLast: true,
    }
  }
}

export const createFilesZip = async (
  files: DownloadFileInfo[],
  onProgress?: (progress: DownloadProgress) => void,
) => {
  for await (const { content } of createFilesZipParts(files, {
    maxFiles: Infinity,
    maxBytes: Infinity,
    onProgress,
  })) {
    return content
  }
  return new JSZip().generateAsync({ type: 'blob' })
}

export const downloadFilesZip = async (
  files: DownloadFileInfo[],
  zipName: string,
  onProgress?: (progress: DownloadProgress) => void,
) => {
  let savedParts = 0
  try {
    for await (const { content, part, isLast } of createFilesZipParts(files, {
      onProgress,
    })) {
      const suffix =
        part === 1 && isLast ? '' : `_part${String(part).padStart(3, '0')}`
      saveAs(content, `${zipName}${suffix}.zip`)
      savedParts++
    }
  } catch (error) {
    if (savedParts > 0) {
      throw new Error(
        t('已发起 {0} 个分包下载，其余未完成；请检查浏览器下载记录。{1}', [
          savedParts,
          error instanceof Error ? error.message : String(error),
        ]),
      )
    }
    throw error
  }
}
