import { exec } from 'child_process'
import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import { getDataDir } from '../data-dir'
import { taskManager } from '../task-manager'
import { templateManager } from '../template-manager'
import {
  compressUploadImage,
  generateThumbnailFile,
  getImageOutputExtension,
  getImageOutputMimeType,
} from './imageProcessor'
import { GENERATED_IMAGES_API_PATH, INPUT_IMAGES_API_PATH } from './enum'

export const IMAGES_ROOT_DIR = path.join(getDataDir(), 'images')
export const GENERATED_IMAGES_DIR = path.join(IMAGES_ROOT_DIR, 'generated')
export const INPUT_IMAGES_DIR = path.join(IMAGES_ROOT_DIR, 'input')
export const THUMB_IMAGES_DIR = path.join(IMAGES_ROOT_DIR, 'thumb')

export type ImageDirectoryType = 'generated' | 'input'

interface ServeImageOptions {
  type: ImageDirectoryType
  filename: string
  thumb?: boolean
}

interface ImageResponseData {
  file: Buffer
  contentType: string
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
  return `image/${ext}`
}

async function ensureThumbnail(
  sourcePath: string,
  thumbPath: string,
): Promise<Buffer | null> {
  await fs.ensureDir(path.dirname(thumbPath))

  if (!(await fs.pathExists(thumbPath))) {
    try {
      await generateThumbnailFile(sourcePath, thumbPath)
    } catch (error) {
      // 编码失败时跳过缩略图，回退到原图
      return null
    }
  }

  if (!(await fs.pathExists(thumbPath))) {
    return null
  }

  return await fs.readFile(thumbPath)
}

export async function uploadInputImage(image: string) {
  if (!image.startsWith('data:image')) {
    throw new Error('Invalid image format')
  }

  const matches = image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/)
  if (!matches) {
    throw new Error('Invalid base64 image data')
  }

  const buffer = Buffer.from(matches[2], 'base64')
  const outputBuffer = await compressUploadImage(buffer)

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
): Promise<ImageResponseData | null> {
  const { filename, thumb = false, type } = options
  const sourceDir = getImageDirectory(type)
  const sourcePath = path.join(sourceDir, filename)

  if (!(await fs.pathExists(sourcePath))) {
    return null
  }

  if (thumb) {
    const thumbPath = getThumbnailPath(type, filename)
    const thumbFile = await ensureThumbnail(sourcePath, thumbPath)
    if (thumbFile) {
      return {
        file: thumbFile,
        contentType: getImageOutputMimeType(),
      }
    }
  }

  return {
    file: await fs.readFile(sourcePath),
    contentType: getImageMimeType(filename),
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

  if (type === 'input') {
    const templates = await templateManager.getTemplates()

    for (const template of templates) {
      if (!Array.isArray(template.images)) {
        continue
      }

      for (const imageUrl of template.images) {
        const filename = getFilenameFromUrl(type, imageUrl)
        if (filename) {
          referencedImages.add(filename)
        }
      }
    }

    return referencedImages
  }

  const tasks = await taskManager.getTasks()

  for (const task of tasks) {
    const imageUrls = Array.isArray(task.outputUrls)
      ? task.outputUrls
      : task.outputUrl
        ? [task.outputUrl]
        : []

    for (const imageUrl of imageUrls) {
      const filename = getFilenameFromUrl(type, imageUrl)
      if (filename) {
        referencedImages.add(filename)
      }
    }
  }

  return referencedImages
}

async function deleteImageFile(type: ImageDirectoryType, filename: string) {
  const filePath = path.join(getImageDirectory(type), filename)
  const thumbPath = getThumbnailPath(type, filename)

  if (await fs.pathExists(filePath)) {
    await fs.remove(filePath)
  }

  if (await fs.pathExists(thumbPath)) {
    await fs.remove(thumbPath)
  }
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
