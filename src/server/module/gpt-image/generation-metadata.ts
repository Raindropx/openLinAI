import { logger } from '../utils/logger'

type SharpFactory = typeof import('sharp')

export type GenerationImageFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'avif'
  | 'tiff'
  | 'svg'

export interface GenerationMetadataInput {
  prompt: string
  model: string
  engine: string
  endpointName?: string
  requestedSize: string
  aspectRatio: string
  quality: string
  referenceImageCount: number
  generatedAt?: string
}

interface GenerationMetadataDocument extends GenerationMetadataInput {
  schema: 'openlinai.image-generation.v1'
  software: 'openLinAI'
  generatedAt: string
  output: {
    format: GenerationImageFormat
    width?: number
    height?: number
  }
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])
const XMP_NAMESPACE = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii')

let sharpFactoryPromise: Promise<SharpFactory | null> | undefined

async function loadSharp(): Promise<SharpFactory | null> {
  if (!sharpFactoryPromise) {
    sharpFactoryPromise = (async (): Promise<SharpFactory | null> => {
      try {
        const module = await import('sharp')
        const defaultExport = (
          module as unknown as { default?: SharpFactory }
        ).default
        return defaultExport || (module as unknown as SharpFactory)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(
          `Sharp is unavailable; AVIF/TIFF generation metadata will be skipped: ${message}`,
        )
        return null
      }
    })()
  }
  const promise = sharpFactoryPromise
  return await promise
}

function limitUtf8(value: string, maxBytes: number): string {
  const source = Buffer.from(value, 'utf8')
  if (source.length <= maxBytes) return value

  let end = maxBytes
  while (end > 0 && (source[end] & 0xc0) === 0x80) end -= 1
  return `${source.subarray(0, end).toString('utf8')}…`
}

function safeParameterValue(value: string): string {
  return value.replace(/[\r\n,]+/g, ' ').trim()
}

function buildParametersText(document: GenerationMetadataDocument): string {
  const { width = 0, height = 0 } = document.output
  const fields = [
    'Steps: 0',
    `Sampler: ${safeParameterValue(document.engine) || 'API'}`,
    'CFG scale: 0',
    'Seed: -1',
    `Size: ${width}x${height}`,
    `Model: ${safeParameterValue(document.model)}`,
    `Quality: ${safeParameterValue(document.quality)}`,
    `Requested size: ${safeParameterValue(document.requestedSize)}`,
    `Aspect ratio: ${safeParameterValue(document.aspectRatio)}`,
    `Reference images: ${document.referenceImageCount}`,
    'Software: openLinAI',
  ]
  if (document.endpointName?.trim()) {
    fields.push(`Endpoint: ${safeParameterValue(document.endpointName)}`)
  }
  return `${document.prompt}\n${fields.join(', ')}`
}

function encodeUtf16Be(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf16le')
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const first = bytes[i]
    bytes[i] = bytes[i + 1]
    bytes[i + 1] = first
  }
  return bytes
}

/** 创建 A1111/Piexif 常用的 EXIF UserComment，并附带基础描述与软件名。 */
function createExifTiff(parameters: string, prompt: string): Buffer {
  const description = Buffer.from(`${limitUtf8(prompt, 8_000)}\0`, 'utf8')
  const software = Buffer.from('openLinAI\0', 'ascii')
  const userComment = Buffer.concat([
    Buffer.from('UNICODE\0', 'ascii'),
    encodeUtf16Be(limitUtf8(parameters, 24_000)),
  ])

  const ifd0Offset = 8
  const ifd0Size = 2 + 3 * 12 + 4
  const exifIfdOffset = ifd0Offset + ifd0Size
  const exifIfdSize = 2 + 12 + 4
  const descriptionOffset = exifIfdOffset + exifIfdSize
  const softwareOffset = descriptionOffset + description.length
  const commentOffset = softwareOffset + software.length
  const tiff = Buffer.alloc(commentOffset + userComment.length)

  tiff.write('II', 0, 'ascii')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(ifd0Offset, 4)

  const writeEntry = (
    offset: number,
    tag: number,
    type: number,
    count: number,
    data: Buffer | number,
  ) => {
    tiff.writeUInt16LE(tag, offset)
    tiff.writeUInt16LE(type, offset + 2)
    tiff.writeUInt32LE(count, offset + 4)
    if (typeof data === 'number') {
      tiff.writeUInt32LE(data, offset + 8)
    } else if (data.length <= 4) {
      data.copy(tiff, offset + 8)
    } else {
      throw new Error('EXIF entry data requires an offset')
    }
  }

  tiff.writeUInt16LE(3, ifd0Offset)
  writeEntry(
    ifd0Offset + 2,
    0x010e,
    2,
    description.length,
    description.length <= 4 ? description : descriptionOffset,
  )
  writeEntry(ifd0Offset + 14, 0x0131, 2, software.length, softwareOffset)
  writeEntry(ifd0Offset + 26, 0x8769, 4, 1, exifIfdOffset)
  tiff.writeUInt32LE(0, ifd0Offset + 38)

  tiff.writeUInt16LE(1, exifIfdOffset)
  writeEntry(exifIfdOffset + 2, 0x9286, 7, userComment.length, commentOffset)
  tiff.writeUInt32LE(0, exifIfdOffset + 14)

  description.copy(tiff, descriptionOffset)
  software.copy(tiff, softwareOffset)
  userComment.copy(tiff, commentOffset)
  return tiff
}

let crcTable: Uint32Array | undefined

function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      crcTable[n] = c >>> 0
    }
  }

  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii')
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  typeBuffer.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, data])),
    8 + data.length,
  )
  return result
}

function createPngInternationalText(keyword: string, text: string): Buffer {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(text, 'utf8'),
  ])
  return createPngChunk('iTXt', data)
}

function isLatin1(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0xff) return false
  }
  return true
}

function createPngLatin1Text(keyword: string, text: string): Buffer {
  return createPngChunk(
    'tEXt',
    Buffer.concat([
      Buffer.from(keyword, 'latin1'),
      Buffer.from([0]),
      Buffer.from(text, 'latin1'),
    ]),
  )
}

function createCompatiblePngParameters(parameters: string): Buffer {
  // spell.novelai.dev only parses a PNG as A1111 when it sees exactly one
  // textual chunk. Its iTXt decoder only handles the Description keyword,
  // while tEXt cannot represent Unicode. EXIF UserComment remains the
  // standards-compatible A1111 fallback for Unicode prompts.
  return isLatin1(parameters)
    ? createPngLatin1Text('parameters', parameters)
    : createPngInternationalText('Description', parameters)
}

function readPngTextKeyword(type: string, data: Buffer): string | undefined {
  if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') return undefined
  const separator = data.indexOf(0)
  if (separator < 0) return undefined
  return data.subarray(0, separator).toString('latin1')
}

type PngTextChunkType = 'tEXt' | 'zTXt' | 'iTXt'

interface PngTextChunkArchiveEntry {
  type: PngTextChunkType
  keyword?: string
  dataBase64: string
}

interface PngMetadataArchive {
  schema: 'openlinai.png-metadata-archive.v1'
  generation: GenerationMetadataDocument
  sourceTextChunks: PngTextChunkArchiveEntry[]
}

const PNG_TEXT_CHUNK_TYPES = new Set<PngTextChunkType>([
  'tEXt',
  'zTXt',
  'iTXt',
])
const OPENLINAI_PNG_ARCHIVE_CHUNK = 'liNa'

function readPngMetadataArchive(data: Buffer): PngTextChunkArchiveEntry[] {
  try {
    const parsed = JSON.parse(data.toString('utf8')) as {
      schema?: unknown
      sourceTextChunks?: unknown
    }
    if (
      parsed.schema !== 'openlinai.png-metadata-archive.v1' ||
      !Array.isArray(parsed.sourceTextChunks)
    ) {
      return []
    }

    return parsed.sourceTextChunks.filter(
      (entry): entry is PngTextChunkArchiveEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.dataBase64 === 'string' &&
        PNG_TEXT_CHUNK_TYPES.has(entry.type),
    )
  } catch {
    return []
  }
}

function createPngMetadataArchive(
  document: GenerationMetadataDocument,
  entries: PngTextChunkArchiveEntry[],
): Buffer {
  const uniqueEntries = [
    ...new Map(
      entries.map((entry) => [`${entry.type}:${entry.dataBase64}`, entry]),
    ).values(),
  ]
  const archive: PngMetadataArchive = {
    schema: 'openlinai.png-metadata-archive.v1',
    generation: document,
    sourceTextChunks: uniqueEntries,
  }
  return createPngChunk(
    OPENLINAI_PNG_ARCHIVE_CHUNK,
    Buffer.from(JSON.stringify(archive), 'utf8'),
  )
}

function embedPngMetadata(
  buffer: Buffer,
  document: GenerationMetadataDocument,
  parameters: string,
  exifTiff: Buffer,
): Buffer {
  const replacementKeys = new Set([
    'parameters',
    'Description',
    'Comment',
    'Software',
    'Source',
  ])
  const chunks: Buffer[] = [PNG_SIGNATURE]
  const sourceTextChunks: PngTextChunkArchiveEntry[] = []
  let offset = PNG_SIGNATURE.length
  let hasExif = false
  let hasIend = false

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > buffer.length) return buffer
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'eXIf') hasExif = true
    if (type === OPENLINAI_PNG_ARCHIVE_CHUNK) {
      sourceTextChunks.push(...readPngMetadataArchive(data))
    } else if (PNG_TEXT_CHUNK_TYPES.has(type as PngTextChunkType)) {
      const keyword = readPngTextKeyword(type, data)
      if (!keyword || !replacementKeys.has(keyword)) {
        sourceTextChunks.push({
          type: type as PngTextChunkType,
          keyword,
          dataBase64: Buffer.from(data).toString('base64'),
        })
      }
    } else if (type === 'IEND') {
      hasIend = true
      chunks.push(
        createCompatiblePngParameters(parameters),
        createPngMetadataArchive(document, sourceTextChunks),
      )
      if (!hasExif) chunks.push(createPngChunk('eXIf', exifTiff))
      chunks.push(buffer.subarray(offset, end))
    } else {
      chunks.push(buffer.subarray(offset, end))
    }
    offset = end
    if (type === 'IEND') break
  }

  return hasIend ? Buffer.concat(chunks) : buffer
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function createXmp(document: GenerationMetadataDocument): Buffer {
  // JPEG APP1 单段最多约 64 KiB；对 XMP 副本设上限，PNG/GIF/SVG 中的
  // 原生 JSON 仍保留完整数据，EXIF UserComment 也有独立的兼容文本。
  const xmpDocument = {
    ...document,
    prompt: limitUtf8(document.prompt, 12_000),
    model: limitUtf8(document.model, 2_000),
    endpointName: document.endpointName
      ? limitUtf8(document.endpointName, 2_000)
      : undefined,
  }
  const json = Buffer.from(JSON.stringify(xmpDocument), 'utf8').toString(
    'base64',
  )
  return Buffer.from(
    `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
      `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
      `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:linai="https://openlinai.local/ns/1.0/">` +
      `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(xmpDocument.prompt)}</rdf:li></rdf:Alt></dc:description>` +
      `<linai:GenerationData encoding="base64">${json}</linai:GenerationData>` +
      `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
    'utf8',
  )
}

function createJpegSegment(marker: number, data: Buffer): Buffer {
  const maxPayload = 0xffff - 2
  const payload = data.subarray(0, maxPayload)
  const result = Buffer.alloc(payload.length + 4)
  result[0] = 0xff
  result[1] = marker
  result.writeUInt16BE(payload.length + 2, 2)
  payload.copy(result, 4)
  return result
}

function embedJpegMetadata(
  buffer: Buffer,
  parameters: string,
  exifTiff: Buffer,
  xmp: Buffer,
): Buffer {
  const exif = createJpegSegment(
    0xe1,
    Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), exifTiff]),
  )
  const xmpSegment = createJpegSegment(
    0xe1,
    Buffer.concat([XMP_NAMESPACE, xmp]),
  )
  const comment = createJpegSegment(
    0xfe,
    Buffer.from(limitUtf8(parameters, 60_000), 'utf8'),
  )
  return Buffer.concat([
    buffer.subarray(0, 2),
    exif,
    xmpSegment,
    comment,
    buffer.subarray(2),
  ])
}

function createWebpChunk(type: string, data: Buffer): Buffer {
  const paddedLength = data.length + (data.length % 2)
  const chunk = Buffer.alloc(8 + paddedLength)
  chunk.write(type, 0, 4, 'ascii')
  chunk.writeUInt32LE(data.length, 4)
  data.copy(chunk, 8)
  return chunk
}

function getPngDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return null
  }

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
])

function getJpegDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) break

    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) break

    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    if (JPEG_START_OF_FRAME_MARKERS.has(marker) && segmentLength >= 7) {
      const height = buffer.readUInt16BE(offset + 3)
      const width = buffer.readUInt16BE(offset + 5)
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += segmentLength
  }
  return null
}

function getGifDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 10) return null
  const signature = buffer.toString('ascii', 0, 6)
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null
  const width = buffer.readUInt16LE(6)
  const height = buffer.readUInt16LE(8)
  return width > 0 && height > 0 ? { width, height } : null
}

function parseSvgLength(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(value)
  if (!match) return undefined
  const number = Number(match[1])
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined
}

function getSvgDimensions(
  buffer: Buffer,
): { width?: number; height?: number } {
  const openingTag = /<svg\b[^>]*>/i.exec(buffer.subarray(0, 16_384).toString('utf8'))
  if (!openingTag) return {}

  const readAttribute = (name: string): string | undefined => {
    const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(
      openingTag[0],
    )
    return match?.[2]
  }
  let width = parseSvgLength(readAttribute('width'))
  let height = parseSvgLength(readAttribute('height'))
  const viewBox = readAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)

  if (
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  ) {
    width ??= Math.round(viewBox[2])
    height ??= Math.round(viewBox[3])
  }
  return { width, height }
}

function getWebpCanvas(
  buffer: Buffer,
): { width: number; height: number } | null {
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    if (dataOffset + length > buffer.length) return null

    if (type === 'VP8X' && length >= 10) {
      return {
        width: 1 + buffer.readUIntLE(dataOffset + 4, 3),
        height: 1 + buffer.readUIntLE(dataOffset + 7, 3),
      }
    }
    if (type === 'VP8 ' && length >= 10) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      }
    }
    if (type === 'VP8L' && length >= 5 && buffer[dataOffset] === 0x2f) {
      const bits = buffer.readUInt32LE(dataOffset + 1)
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      }
    }
    offset = dataOffset + length + (length % 2)
  }
  return null
}

function embedWebpMetadata(
  buffer: Buffer,
  exifTiff: Buffer,
  xmp: Buffer,
): Buffer {
  const canvas = getWebpCanvas(buffer)
  if (!canvas) return buffer

  const sourceChunks: Array<{ type: string; data: Buffer }> = []
  const originalMetadataChunks: Array<{ type: string; data: Buffer }> = []
  let offset = 12
  let flags = 0x0c
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    const end = offset + 8 + length + (length % 2)
    if (end > buffer.length) return buffer
    const data = Buffer.from(buffer.subarray(offset + 8, offset + 8 + length))

    if (type === 'VP8X' && data.length >= 10) flags |= data[0]
    if (type === 'ICCP') flags |= 0x20
    if (type === 'ALPH') flags |= 0x10
    if (
      type === 'VP8L' &&
      data.length >= 5 &&
      data[0] === 0x2f &&
      (data.readUInt32LE(1) & 0x10000000) !== 0
    ) {
      flags |= 0x10
    }
    if (type === 'ANIM') flags |= 0x02
    if (type === 'EXIF' || type === 'XMP ') {
      originalMetadataChunks.push({ type, data })
    } else if (type !== 'VP8X') {
      sourceChunks.push({ type, data })
    }
    offset = end
  }

  const vp8x = Buffer.alloc(10)
  vp8x[0] = flags
  vp8x.writeUIntLE(canvas.width - 1, 4, 3)
  vp8x.writeUIntLE(canvas.height - 1, 7, 3)
  const chunks = [
    createWebpChunk('VP8X', vp8x),
    ...sourceChunks.map((chunk) => createWebpChunk(chunk.type, chunk.data)),
    createWebpChunk('EXIF', exifTiff),
    createWebpChunk('XMP ', xmp),
    ...originalMetadataChunks.map((chunk) =>
      createWebpChunk(chunk.type, chunk.data),
    ),
  ]
  const payload = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...chunks])
  const result = Buffer.alloc(8 + payload.length)
  result.write('RIFF', 0, 4, 'ascii')
  result.writeUInt32LE(payload.length, 4)
  payload.copy(result, 8)
  return result
}

function embedGifMetadata(
  buffer: Buffer,
  document: GenerationMetadataDocument,
): Buffer {
  const trailer = buffer.lastIndexOf(0x3b)
  if (trailer < 0) return buffer
  const bytes = Buffer.from(`openLinAI\n${JSON.stringify(document)}`, 'utf8')
  const blocks: Buffer[] = [Buffer.from([0x21, 0xfe])]
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const part = bytes.subarray(offset, offset + 255)
    blocks.push(Buffer.from([part.length]), part)
  }
  blocks.push(Buffer.from([0]))
  return Buffer.concat([
    buffer.subarray(0, trailer),
    ...blocks,
    buffer.subarray(trailer),
  ])
}

function embedSvgMetadata(
  buffer: Buffer,
  document: GenerationMetadataDocument,
): Buffer {
  const svg = buffer.toString('utf8')
  const openingTagEnd = svg.search(/<svg\b[^>]*>/i)
  if (openingTagEnd < 0) return buffer
  const closingBracket = svg.indexOf('>', openingTagEnd)
  if (closingBracket < 0) return buffer
  const metadata =
    `<metadata id="openlinai-generation">${escapeXml(JSON.stringify(document))}</metadata>` +
    `<desc>${escapeXml(document.prompt)}</desc>`
  return Buffer.from(
    `${svg.slice(0, closingBracket + 1)}${metadata}${svg.slice(closingBracket + 1)}`,
    'utf8',
  )
}

async function embedWithSharp(
  sharp: SharpFactory,
  buffer: Buffer,
  format: 'avif' | 'tiff',
  document: GenerationMetadataDocument,
  parameters: string,
  xmp: Buffer,
): Promise<Buffer> {
  const pipeline = sharp(buffer)
    .keepMetadata()
    .withExifMerge({
      IFD0: {
        ImageDescription: limitUtf8(document.prompt, 8_000),
        Software: document.software,
        UserComment: limitUtf8(parameters, 24_000),
      },
    })
    .withXmp(xmp.toString('utf8'))
  return format === 'avif'
    ? pipeline.avif({ lossless: true }).toBuffer()
    : pipeline.tiff({ compression: 'lzw' }).toBuffer()
}

export async function embedGenerationMetadata(
  buffer: Buffer,
  format: GenerationImageFormat,
  input: GenerationMetadataInput,
): Promise<Buffer> {
  const sharp =
    format === 'avif' || format === 'tiff' ? await loadSharp() : null
  if ((format === 'avif' || format === 'tiff') && !sharp) return buffer

  const imageMetadata =
    format === 'png'
      ? getPngDimensions(buffer) || {}
      : format === 'jpeg'
        ? getJpegDimensions(buffer) || {}
        : format === 'webp'
          ? getWebpCanvas(buffer) || {}
          : format === 'gif'
            ? getGifDimensions(buffer) || {}
            : format === 'svg'
              ? getSvgDimensions(buffer)
              : await sharp!(buffer, { animated: true }).metadata()
  const document: GenerationMetadataDocument = {
    ...input,
    schema: 'openlinai.image-generation.v1',
    software: 'openLinAI',
    generatedAt: input.generatedAt || new Date().toISOString(),
    output: {
      format,
      width: imageMetadata.width,
      height: imageMetadata.height,
    },
  }
  const parameters = buildParametersText(document)
  const exifTiff = createExifTiff(parameters, document.prompt)
  const xmp = createXmp(document)

  switch (format) {
    case 'png':
      return embedPngMetadata(buffer, document, parameters, exifTiff)
    case 'jpeg':
      return embedJpegMetadata(buffer, parameters, exifTiff, xmp)
    case 'webp':
      return embedWebpMetadata(buffer, exifTiff, xmp)
    case 'gif':
      return embedGifMetadata(buffer, document)
    case 'svg':
      return embedSvgMetadata(buffer, document)
    case 'avif':
    case 'tiff':
      return await embedWithSharp(
        sharp!,
        buffer,
        format,
        document,
        parameters,
        xmp,
      )
  }
}
