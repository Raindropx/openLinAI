import { exec } from 'child_process'
import crypto from 'crypto'
import fs from 'fs-extra'
import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'path'
import { mapBackupImageUrls } from '../../../shared/task-backup'
import type { ThumbnailCacheStatus } from '../../../shared/thumbnail-cache'
import { readImageHeaderDimensions } from '../../module/gpt-image/generation-metadata'
import { getDataDir } from '../data-dir'
import { taskManager } from '../task-manager'
import { templateManager } from '../template-manager'
import { GENERATED_IMAGES_API_PATH, INPUT_IMAGES_API_PATH } from './enum'
import {
  compressUploadImage,
  generateThumbnailFile,
  getImageOutputExtension,
  getImageOutputMimeType,
  IMAGE_MAX_DIMENSION,
} from './imageProcessor'

export const IMAGES_ROOT_DIR = path.join(getDataDir(), 'images')
export const GENERATED_IMAGES_DIR = path.join(IMAGES_ROOT_DIR, 'generated')
export const INPUT_IMAGES_DIR = path.join(IMAGES_ROOT_DIR, 'input')
export const THUMB_IMAGES_DIR = path.join(IMAGES_ROOT_DIR, 'thumb')
export const IMAGE_UPLOAD_MAX_BYTES = 16 * 1024 * 1024
export const IMAGE_UPLOAD_REQUEST_MAX_BYTES =
  Math.ceil(IMAGE_UPLOAD_MAX_BYTES / 3) * 4 + 4096

export class ImageUploadTooLargeError extends Error {
  constructor() {
    super('图片过大，请上传不超过 16 MiB 的图片')
    this.name = 'ImageUploadTooLargeError'
  }
}

export type ImageDirectoryType = 'generated' | 'input'

interface ServeImageOptions {
  type: ImageDirectoryType
  filename: string
  thumb?: boolean
  headOnly?: boolean
}

interface ListedImageInfo {
  url: string
  type: ImageDirectoryType
  createdAt: number
}

interface DeleteUnreferencedImagesOptions {
  type: ImageDirectoryType
  urls?: string[]
}

fs.ensureDirSync(GENERATED_IMAGES_DIR)
fs.ensureDirSync(INPUT_IMAGES_DIR)
fs.ensureDirSync(THUMB_IMAGES_DIR)

function getImageDirectory(type: ImageDirectoryType) {
  return type === 'generated' ? GENERATED_IMAGES_DIR : INPUT_IMAGES_DIR
}

function getThumbnailPath(type: ImageDirectoryType, filename: string) {
  return path.join(
    THUMB_IMAGES_DIR,
    type,
    `${path.parse(filename).name}${getImageOutputExtension()}`,
  )
}

function getImageApiPath(type: ImageDirectoryType) {
  return type === 'generated'
    ? GENERATED_IMAGES_API_PATH
    : INPUT_IMAGES_API_PATH
}

function getImageMimeType(filename: string) {
  const ext = path.extname(filename).slice(1).toLowerCase()
  if (ext === 'jpg') {
    return 'image/jpeg'
  }
  if (ext === 'webp') {
    return 'image/webp'
  }
  if (ext === 'svg') {
    return 'image/svg+xml'
  }
  return `image/${ext}`
}

const thumbnailJobs = new Map<string, Promise<boolean>>()
const thumbnailLocks = new Map<string, Promise<unknown>>()

// Both backends use the same source stem. Serialize generation, deletion and
// maintenance for that stem so a pending encoder cannot resurrect deleted cache.
async function withThumbnailLock<T>(
  thumbPath: string,
  action: () => Promise<T>,
) {
  const key = path.join(path.dirname(thumbPath), path.parse(thumbPath).name)
  const previous = thumbnailLocks.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(action)
  thumbnailLocks.set(key, current)
  try {
    return await current
  } finally {
    if (thumbnailLocks.get(key) === current) thumbnailLocks.delete(key)
  }
}

async function ensureThumbnail(
  sourcePath: string,
  thumbPath: string,
): Promise<boolean> {
  const pending = thumbnailJobs.get(thumbPath)
  if (pending) return pending
  const job = withThumbnailLock(thumbPath, async () => {
    if (!(await fs.pathExists(sourcePath))) return false
    if (await fs.pathExists(thumbPath)) return true
    return writeThumbnail(sourcePath, thumbPath)
  })
  thumbnailJobs.set(thumbPath, job)
  try {
    return await job
  } finally {
    thumbnailJobs.delete(thumbPath)
  }
}

/** Caller holds the per-image lock. */
async function writeThumbnail(
  sourcePath: string,
  thumbPath: string,
): Promise<boolean> {
  await fs.ensureDir(path.dirname(thumbPath))
  // Publish only complete files; another request must never read a partial JPEG.
  const temporary = `${thumbPath}.${crypto.randomUUID()}${getImageOutputExtension()}`
  try {
    await generateThumbnailFile(sourcePath, temporary)
    if (!(await fs.pathExists(temporary)) || !(await fs.pathExists(sourcePath)))
      return false
    await fs.rename(temporary, thumbPath)
    return true
  } catch {
    return false
  } finally {
    await fs.remove(temporary).catch(() => {})
  }
}

function imageSourcePath(type: ImageDirectoryType, filename: string) {
  if (
    !filename ||
    /[\\/\x00]/.test(filename) ||
    filename === '.' ||
    filename === '..'
  )
    return null
  return path.join(getImageDirectory(type), filename)
}

/** File size always refers to the original. Unknown dimensions are omitted. */
export async function getImageInfo(type: ImageDirectoryType, filename: string) {
  const sourcePath = imageSourcePath(type, filename)
  if (!sourcePath) return null
  const file = await open(sourcePath, 'r').catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!file) return null
  try {
    const stat = await file.stat()
    if (!stat.isFile()) return null
    const header = Buffer.alloc(Math.min(stat.size, 256 * 1024))
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    return {
      bytes: stat.size,
      ...readImageHeaderDimensions(header.subarray(0, bytesRead)),
    }
  } finally {
    await file.close()
  }
}

export async function uploadInputImage(
  image: string,
  options?: { maxDimension?: number },
) {
  if (!image.startsWith('data:image')) {
    throw new Error('Invalid image format')
  }

  const matches = image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/)
  if (!matches) {
    throw new Error('Invalid base64 image data')
  }

  const buffer = Buffer.from(matches[2], 'base64')
  if (buffer.length > IMAGE_UPLOAD_MAX_BYTES) {
    throw new ImageUploadTooLargeError()
  }
  const outputBuffer = await compressUploadImage(
    buffer,
    options?.maxDimension ?? IMAGE_MAX_DIMENSION,
  )

  const hash = crypto.createHash('md5').update(outputBuffer).digest('hex')
  const filename = `${hash}${getImageOutputExtension()}`
  const filepath = path.join(INPUT_IMAGES_DIR, filename)

  if (!(await fs.pathExists(filepath))) {
    await fs.writeFile(filepath, outputBuffer)
  }

  return {
    url: `${INPUT_IMAGES_API_PATH}/${filename}`,
  }
}

export async function serveImage(
  options: ServeImageOptions,
): Promise<Response | null> {
  const { filename, thumb = false, type, headOnly = false } = options
  const sourcePath = imageSourcePath(type, filename)

  if (!sourcePath || !(await fs.pathExists(sourcePath))) {
    return null
  }

  let filePath = sourcePath
  let contentType = getImageMimeType(filename)
  if (thumb) {
    const thumbPath = getThumbnailPath(type, filename)
    if (await ensureThumbnail(sourcePath, thumbPath)) {
      filePath = thumbPath
      contentType = getImageOutputMimeType()
    }
  }

  const file = await open(filePath, 'r').catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!file) return null
  try {
    const stat = await file.stat()
    if (!stat.isFile()) {
      await file.close()
      return null
    }
    const headers = {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=86400, immutable',
    }
    if (headOnly) {
      await file.close()
      return new Response(null, { headers })
    }
    const stream = file.createReadStream({ highWaterMark: 64 * 1024 })
    return new Response(
      Readable.toWeb(stream, {
        strategy: {
          highWaterMark: 64 * 1024,
          size: (chunk: Uint8Array) => chunk.byteLength,
        },
      }) as ReadableStream<Uint8Array>,
      { headers },
    )
  } catch (error) {
    await file.close().catch(() => {})
    throw error
  }
}

export function openImageDirectory(type: ImageDirectoryType) {
  const targetDir = getImageDirectory(type)
  const command =
    process.platform === 'win32'
      ? `start "" "${targetDir}"`
      : process.platform === 'darwin'
        ? `open "${targetDir}"`
        : `xdg-open "${targetDir}"`

  exec(command)
}

function getFilenameFromUrl(type: ImageDirectoryType, url: string) {
  const apiPath = getImageApiPath(type)

  if (!url.startsWith(apiPath)) {
    return null
  }

  const filename = url
    .slice(apiPath.length + 1)
    .split('?')[0]
    .split('#')[0]
    .trim()

  return filename ? path.basename(filename) : null
}

async function getReferencedImageFilenames(type: ImageDirectoryType) {
  const referencedImages = new Set<string>()
  const { studioManager } = await import('../studio-manager')
  // Task snapshots and shelf provenance remain references even without a saved template.
  mapBackupImageUrls(
    [
      await templateManager.getTemplates(),
      await taskManager.getTasks(),
      await studioManager.list(),
    ],
    (url) => {
      const filename = getFilenameFromUrl(type, url)
      if (filename) referencedImages.add(filename)
      return url
    },
  )
  return referencedImages
}

export async function deleteImageFile(
  type: ImageDirectoryType,
  filename: string,
) {
  const filePath = imageSourcePath(type, filename)
  if (!filePath) throw new Error('Invalid image filename')
  const thumbPath = getThumbnailPath(type, filename)
  await withThumbnailLock(thumbPath, async () => {
    await unlinkIfPresent(filePath)
    // Include old caches left by switching between Sharp and FFmpeg.
    for (const extension of ['.jpg', '.webp'])
      await unlinkIfPresent(
        path.join(
          path.dirname(thumbPath),
          `${path.parse(thumbPath).name}${extension}`,
        ),
      )
  })
}

async function unlinkIfPresent(filename: string) {
  await fs.unlink(filename).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
}

const THUMBNAIL_SWEEP_INTERVAL = 6 * 60 * 60 * 1000
const TEMP_THUMBNAIL_MAX_AGE = 24 * 60 * 60 * 1000
const TEMP_THUMBNAIL_PATTERN =
  /^(.*\.(?:jpg|webp))\.[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\.(?:jpg|webp)$/i
let thumbnailSweep: Promise<{ removed: number }> | undefined

/** Only cache files are removed. Original images and task records are untouched. */
export function cleanupThumbnailCache(): Promise<{ removed: number }> {
  if (thumbnailSweep) return thumbnailSweep
  thumbnailSweep = sweepThumbnailCache().finally(() => {
    thumbnailSweep = undefined
  })
  return thumbnailSweep
}

async function sweepThumbnailCache() {
  let removed = 0
  for (const type of ['generated', 'input'] as const) {
    const sourceDir = getImageDirectory(type)
    // Fail closed if the source directory is unavailable (e.g. disconnected disk).
    let sourceDirectoryMtime = (await fs.stat(sourceDir)).mtimeMs
    const sources = await fs.readdir(sourceDir)
    const sourceStems = new Set(sources.map((name) => path.parse(name).name))
    const thumbDir = path.join(THUMB_IMAGES_DIR, type)
    if (!(await fs.pathExists(thumbDir))) continue
    const entries = await fs.readdir(thumbDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const temporary = TEMP_THUMBNAIL_PATTERN.exec(entry.name)
      if (!temporary && !/\.(jpg|webp)$/i.test(entry.name)) continue
      const cacheName = temporary?.[1] ?? entry.name
      const stem = path.parse(cacheName).name
      if (!temporary && sourceStems.has(stem)) continue
      const cachePath = path.join(thumbDir, cacheName)
      const key = path.join(thumbDir, stem)
      // Do not wait for or disturb an active/queued image operation.
      if (thumbnailLocks.has(key) || thumbnailJobs.has(cachePath)) continue
      await withThumbnailLock(cachePath, async () => {
        const target = path.join(thumbDir, entry.name)
        const stat = await fs.lstat(target).catch((error) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (!stat?.isFile()) return
        if (temporary && Date.now() - stat.mtimeMs < TEMP_THUMBNAIL_MAX_AGE)
          return
        // A source may have been restored since the directory snapshot. Refresh
        // only when its directory changes, not once for every orphan thumbnail.
        const currentSourceStat = await fs.stat(sourceDir)
        if (currentSourceStat.mtimeMs !== sourceDirectoryMtime) {
          sourceStems.clear()
          for (const name of await fs.readdir(sourceDir))
            sourceStems.add(path.parse(name).name)
          sourceDirectoryMtime = currentSourceStat.mtimeMs
        }
        if (!temporary && sourceStems.has(stem)) return
        await unlinkIfPresent(target)
        removed++
      })
    }
  }
  return { removed }
}

let thumbnailMaintenanceTimer: ReturnType<typeof setTimeout> | undefined

let thumbnailRebuild: ThumbnailCacheStatus = {
  state: 'idle',
  phase: 'clearing',
  total: 0,
  processed: 0,
  regenerated: 0,
  failed: 0,
  skipped: 0,
  removed: 0,
}

export function getThumbnailCacheStatus(): ThumbnailCacheStatus {
  return { ...thumbnailRebuild }
}

/** Idempotent while running, including requests from another settings window. */
export function startThumbnailCacheRebuild(): ThumbnailCacheStatus {
  if (thumbnailRebuild.state === 'running') return getThumbnailCacheStatus()
  const job: ThumbnailCacheStatus = {
    id: crypto.randomUUID(),
    state: 'running',
    phase: 'clearing',
    total: 0,
    processed: 0,
    regenerated: 0,
    failed: 0,
    skipped: 0,
    removed: 0,
  }
  thumbnailRebuild = job
  void rebuildThumbnailCache(job)
    .then(() => {
      job.state = 'completed'
    })
    .catch((error) => {
      job.state = 'failed'
      job.error = '缩略图缓存重建失败，请检查服务日志'
      console.error('Thumbnail cache rebuild failed:', error)
    })
  return getThumbnailCacheStatus()
}

async function rebuildThumbnailCache(job: ThumbnailCacheStatus) {
  const plans: { type: ImageDirectoryType; filename: string }[] = []
  // Read both source directories before deleting any cache. An unavailable disk
  // is an error, never an empty library. Do not follow symlinks or recurse.
  for (const type of ['generated', 'input'] as const) {
    for (const file of await fs.readdir(getImageDirectory(type), {
      withFileTypes: true,
    })) {
      if (
        file.isFile() &&
        /\.(png|jpe?g|webp|gif|avif|tiff?|bmp|svg)$/i.test(file.name)
      )
        plans.push({ type, filename: file.name })
    }
  }
  job.total = plans.length
  for (const type of ['generated', 'input'] as const) {
    const directory = path.join(THUMB_IMAGES_DIR, type)
    if (!(await fs.pathExists(directory))) continue
    for (const file of await fs.readdir(directory, { withFileTypes: true })) {
      if (!file.isFile() || !/\.(jpg|webp)$/i.test(file.name)) continue
      const target = path.join(directory, file.name)
      const cacheName = TEMP_THUMBNAIL_PATTERN.exec(file.name)?.[1] ?? file.name
      await withThumbnailLock(path.join(directory, cacheName), async () => {
        if (
          !(
            await fs.lstat(target).catch((error) => {
              if (error.code === 'ENOENT') return null
              throw error
            })
          )?.isFile()
        )
          return
        await unlinkIfPresent(target)
        job.removed++
      })
    }
  }
  job.phase = 'rebuilding'
  // Process one source at a time on both backends. No image buffers accumulate
  // in a job queue, and existing FFmpeg concurrency limits still apply.
  for (const { type, filename } of plans) {
    const source = imageSourcePath(type, filename)!
    const thumbnail = getThumbnailPath(type, filename)
    await withThumbnailLock(thumbnail, async () => {
      if (!(await fs.pathExists(source))) {
        job.skipped++
        return
      }
      // A viewer may have warmed this cache during the clearing phase.
      await unlinkIfPresent(thumbnail)
      if (await writeThumbnail(source, thumbnail)) job.regenerated++
      else job.failed++
    })
    job.processed++
  }
}

/** One delayed startup sweep, then six hours after each completed sweep. */
export function startThumbnailCacheMaintenance() {
  if (thumbnailMaintenanceTimer) return
  const schedule = (delay: number) => {
    thumbnailMaintenanceTimer = setTimeout(async () => {
      try {
        await cleanupThumbnailCache()
      } catch (error) {
        console.error('Thumbnail cache maintenance failed:', error)
      } finally {
        schedule(THUMBNAIL_SWEEP_INTERVAL)
      }
    }, delay)
    thumbnailMaintenanceTimer.unref()
  }
  schedule(60 * 1000)
}

export async function deleteUnreferencedImages(
  options: DeleteUnreferencedImagesOptions,
) {
  const { type, urls } = options
  const referencedImages = await getReferencedImageFilenames(type)
  const targetDir = getImageDirectory(type)
  const targetFilenames = new Set<string>()

  if (Array.isArray(urls) && urls.length > 0) {
    for (const url of urls) {
      const filename = getFilenameFromUrl(type, url)
      if (filename) {
        targetFilenames.add(filename)
      }
    }
  } else {
    const files = await fs.readdir(targetDir)

    for (const file of files) {
      const filePath = path.join(targetDir, file)
      const stat = await fs.stat(filePath)
      if (stat.isFile()) {
        targetFilenames.add(file)
      }
    }
  }

  let deletedCount = 0
  let skippedCount = 0

  for (const filename of targetFilenames) {
    if (referencedImages.has(filename)) {
      skippedCount++
      continue
    }

    await deleteImageFile(type, filename)
    deletedCount++
  }

  return { deletedCount, skippedCount }
}

async function getFilesInfo(
  dir: string,
  apiPath: string,
  type: ImageDirectoryType,
): Promise<ListedImageInfo[]> {
  if (!(await fs.pathExists(dir))) {
    return []
  }

  const files = await fs.readdir(dir)
  const info: ListedImageInfo[] = []

  for (const file of files) {
    const filepath = path.join(dir, file)
    const stat = await fs.stat(filepath)

    if (!stat.isFile()) {
      continue
    }

    info.push({
      url: `${apiPath}/${file}`,
      type,
      createdAt: stat.mtimeMs,
    })
  }

  return info
}

export async function listImages() {
  const generatedInfo = await getFilesInfo(
    GENERATED_IMAGES_DIR,
    GENERATED_IMAGES_API_PATH,
    'generated',
  )
  const inputInfo = await getFilesInfo(
    INPUT_IMAGES_DIR,
    INPUT_IMAGES_API_PATH,
    'input',
  )

  return [...generatedInfo, ...inputInfo].sort(
    (a, b) => b.createdAt - a.createdAt,
  )
}
