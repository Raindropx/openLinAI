import crypto from 'crypto'
import fs from 'fs-extra'
import { writeFile } from 'fs/promises'
import path from 'path'
import { GENERATED_IMAGES_DIR } from '../../common/static'
import { fetchWithTimeout } from '../utils/fetch'
import { logger } from '../utils/logger'

interface PersistedImageFormat {
  extension: 'jpg' | 'png' | 'webp' | 'gif' | 'avif' | 'svg'
}

const MIME_FORMATS: Record<string, PersistedImageFormat> = {
  'image/jpeg': { extension: 'jpg' },
  'image/jpg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
  'image/gif': { extension: 'gif' },
  'image/avif': { extension: 'avif' },
  'image/svg+xml': { extension: 'svg' },
}

export function getImageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.avif':
      return 'image/avif'
    case '.svg':
      return 'image/svg+xml'
    default:
      throw new Error(
        `[服务] Unsupported image format: ${path.extname(filePath) || 'unknown'}`,
      )
  }
}

export async function readImageAsDataUrl(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  return `data:${getImageMimeType(filePath)};base64,${buffer.toString('base64')}`
}

function detectImageFormat(
  buffer: Buffer,
  mimeHint?: string | null,
): PersistedImageFormat | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return MIME_FORMATS['image/jpeg']
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return MIME_FORMATS['image/png']
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return MIME_FORMATS['image/webp']
  }

  if (buffer.length >= 6) {
    const signature = buffer.toString('ascii', 0, 6)
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return MIME_FORMATS['image/gif']
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp' &&
    ['avif', 'avis'].includes(buffer.toString('ascii', 8, 12))
  ) {
    return MIME_FORMATS['image/avif']
  }

  const textPrefix = buffer.subarray(0, 1024).toString('utf8').trimStart()
  if (/^(?:<\?xml[\s\S]*?)?<svg\b/i.test(textPrefix)) {
    return MIME_FORMATS['image/svg+xml']
  }

  const normalizedMime = mimeHint?.split(';', 1)[0].trim().toLowerCase()
  if (normalizedMime && MIME_FORMATS[normalizedMime]) {
    return MIME_FORMATS[normalizedMime]
  }

  return null
}

/** 清除 SVG 中可能在同源站点执行脚本或加载外部资源的内容。 */
function sanitizeSvg(buffer: Buffer): Buffer {
  let svg = buffer.toString('utf8')
  svg = svg
    .replace(
      /<(?:script|foreignObject|iframe|object|embed)\b[\s\S]*?<\/(?:script|foreignObject|iframe|object|embed)\s*>/gi,
      '',
    )
    .replace(/<(?:script|foreignObject|iframe|object|embed)\b[^>]*\/?\s*>/gi, '')
    .replace(/@import\s+[^;]+;?/gi, '')
    .replace(/\son[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, '')
    .replace(
      /\s(?:href|xlink:href)\s*=\s*(["'])(?!#)[\s\S]*?\1/gi,
      '',
    )
    .replace(/url\(\s*(["']?)(?!#)[^)]+\1\s*\)/gi, 'none')
  return Buffer.from(svg, 'utf8')
}

async function normalizeImageBuffer(
  buffer: Buffer,
  format: PersistedImageFormat,
): Promise<{ buffer: Buffer; format: PersistedImageFormat }> {
  if (format.extension !== 'svg') return { buffer, format }
  return { buffer: sanitizeSvg(buffer), format }
}

/** 把 data URL 或远程图片按真实格式落盘，返回文件名列表。 */
export async function persistImages(imageUrls: string[]): Promise<string[]> {
  const filenames: string[] = []
  for (const url of imageUrls) {
    let buffer: Buffer
    let mimeHint: string | null = null

    if (url.startsWith('data:')) {
      const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(url)
      if (!match) continue
      mimeHint = match[1]
      buffer = Buffer.from(match[2], 'base64')
    } else {
      const res = await fetchWithTimeout(url, {}, 30000)
      if (!res.ok) {
        logger.error(`Failed to fetch image: ${url} (${res.status})`)
        continue
      }
      mimeHint = res.headers.get('content-type')
      buffer = Buffer.from(await res.arrayBuffer())
    }

    const detectedFormat = detectImageFormat(buffer, mimeHint)
    if (!detectedFormat) {
      logger.error(`Unsupported generated image format: ${mimeHint || 'unknown'}`)
      continue
    }

    const normalized = await normalizeImageBuffer(buffer, detectedFormat)
    buffer = normalized.buffer
    const hash = crypto.createHash('md5').update(buffer).digest('hex')
    const filename = `${hash}.${normalized.format.extension}`
    await writeFile(path.join(GENERATED_IMAGES_DIR, filename), buffer)
    filenames.push(filename)
  }
  return filenames
}
