import { saveAs } from 'file-saver'
import dayjs from 'dayjs'

/** SillyTavern 角色卡数据（扁平结构，用于编辑） */
export interface CharacterCard {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  tags: string[]
  alternate_greetings?: string[]
  creator?: string
  character_version?: string
}

export const emptyCharacterCard: CharacterCard = {
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  tags: [],
}

// ── CRC-32 ──────────────────────────────────────────────

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1)
      else c = c >>> 1
    }
    table[i] = c
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ── PNG chunk 操作 ──────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

interface PngChunk {
  type: string
  data: Uint8Array
  /** 在原始文件中的偏移（length 字段起始位置） */
  offset: number
  /** 完整 chunk 长度：length(4) + type(4) + data + crc(4) */
  totalLength: number
}

/** 解析 PNG chunk 列表 */
function parsePngChunks(buffer: ArrayBuffer): PngChunk[] {
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('不是有效的 PNG 文件')
    }
  }
  const chunks: PngChunk[] = []
  let offset = PNG_SIGNATURE.length
  const view = new DataView(buffer)
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    const data = bytes.slice(offset + 8, offset + 8 + length)
    const totalLength = 4 + 4 + length + 4
    chunks.push({ type, data, offset, totalLength })
    offset += totalLength
  }
  return chunks
}

/** UTF-8 安全的 base64 编码 */
function utf8ToBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

/** UTF-8 安全的 base64 解码 */
function base64ToUtf8(b64: string): string {
  return decodeURIComponent(escape(atob(b64)))
}

/** 从 PNG 的 tEXt chunk 中提取角色卡原始 JSON 对象 */
export function parsePngCharacterCardRaw(
  buffer: ArrayBuffer,
): any | null {
  const chunks = parsePngChunks(buffer)
  for (const chunk of chunks) {
    if (chunk.type !== 'tEXt') continue
    const nullIndex = chunk.data.indexOf(0)
    if (nullIndex === -1) continue
    const keyword = new TextDecoder().decode(chunk.data.slice(0, nullIndex))
    if (keyword !== 'chara') continue
    const textBytes = chunk.data.slice(nullIndex + 1)
    const base64 = new TextDecoder().decode(textBytes)
    try {
      const json = base64ToUtf8(base64)
      return JSON.parse(json)
    } catch {
      return null
    }
  }
  return null
}

/** 从 PNG 的 tEXt chunk 中提取角色卡数据 */
export function parsePngCharacterCard(
  buffer: ArrayBuffer,
): CharacterCard | null {
  const raw = parsePngCharacterCardRaw(buffer)
  return raw ? normalizeCharacterCard(raw) : null
}

/** 将角色卡数据写入 PNG（在 IEND 前插入 tEXt chunk，移除旧 chara chunk） */
export function writePngCharacterCard(
  pngBuffer: ArrayBuffer,
  card: CharacterCard,
  extraFields?: Record<string, any>,
): ArrayBuffer {
  const v2Card = toV2Format(card, extraFields)
  const json = JSON.stringify(v2Card)
  const base64 = utf8ToBase64(json)

  // tEXt chunk data: "chara\0" + base64
  const keywordBytes = new TextEncoder().encode('chara')
  const textBytes = new TextEncoder().encode(base64)
  const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length)
  chunkData.set(keywordBytes, 0)
  chunkData[keywordBytes.length] = 0 // null separator
  chunkData.set(textBytes, keywordBytes.length + 1)

  // chunk content for CRC: type(4) + data
  const typeBytes = new TextEncoder().encode('tEXt')
  const crcContent = new Uint8Array(typeBytes.length + chunkData.length)
  crcContent.set(typeBytes, 0)
  crcContent.set(chunkData, typeBytes.length)
  const crc = crc32(crcContent)

  // 完整 chunk: length(4) + type(4) + data + crc(4)
  const fullChunk = new Uint8Array(4 + 4 + chunkData.length + 4)
  const dv = new DataView(fullChunk.buffer)
  dv.setUint32(0, chunkData.length)
  fullChunk.set(typeBytes, 4)
  fullChunk.set(chunkData, 8)
  dv.setUint32(8 + chunkData.length, crc)

  // 解析原 PNG，过滤掉已有 chara tEXt chunk，在 IEND 前插入
  const chunks = parsePngChunks(pngBuffer)
  const filteredChunks = chunks.filter((c) => {
    if (c.type !== 'tEXt') return true
    const nullIndex = c.data.indexOf(0)
    if (nullIndex === -1) return true
    const keyword = new TextDecoder().decode(c.data.slice(0, nullIndex))
    return keyword !== 'chara'
  })

  const iendIndex = filteredChunks.findIndex((c) => c.type === 'IEND')
  if (iendIndex === -1) {
    throw new Error('PNG 缺少 IEND chunk')
  }

  const beforeIend = filteredChunks.slice(0, iendIndex)
  const afterIend = filteredChunks.slice(iendIndex)

  const signatureSize = PNG_SIGNATURE.length
  const beforeSize = beforeIend.reduce((sum, c) => sum + c.totalLength, 0)
  const afterSize = afterIend.reduce((sum, c) => sum + c.totalLength, 0)
  const totalSize = signatureSize + beforeSize + fullChunk.length + afterSize

  const result = new Uint8Array(totalSize)
  let pos = 0

  result.set(PNG_SIGNATURE, pos)
  pos += signatureSize

  for (const chunk of beforeIend) {
    const chunkBytes = new Uint8Array(pngBuffer, chunk.offset, chunk.totalLength)
    result.set(chunkBytes, pos)
    pos += chunk.totalLength
  }

  result.set(fullChunk, pos)
  pos += fullChunk.length

  for (const chunk of afterIend) {
    const chunkBytes = new Uint8Array(pngBuffer, chunk.offset, chunk.totalLength)
    result.set(chunkBytes, pos)
    pos += chunk.totalLength
  }

  return result.buffer
}

// ── 格式转换 ────────────────────────────────────────────

const STANDARD_FIELDS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'tags',
  'alternate_greetings',
  'creator',
  'character_version',
]

/** 将任意 JSON 规范化为 CharacterCard（兼容 V1 扁平和 V2 spec/data 格式） */
export function normalizeCharacterCard(raw: any): CharacterCard {
  // V2 格式: { spec, spec_version, data: {...} }
  if (raw?.spec === 'chara_card_v2' && raw.data) {
    const d = raw.data
    return {
      name: d.name ?? '',
      description: d.description ?? '',
      personality: d.personality ?? '',
      scenario: d.scenario ?? '',
      first_mes: d.first_mes ?? '',
      mes_example: d.mes_example ?? '',
      tags: Array.isArray(d.tags) ? d.tags : [],
      alternate_greetings: Array.isArray(d.alternate_greetings)
        ? d.alternate_greetings
        : undefined,
      creator: d.creator,
      character_version: d.character_version,
    }
  }
  // V1 格式: 扁平结构
  return {
    name: raw?.name ?? '',
    description: raw?.description ?? '',
    personality: raw?.personality ?? '',
    scenario: raw?.scenario ?? '',
    first_mes: raw?.first_mes ?? '',
    mes_example: raw?.mes_example ?? '',
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
    alternate_greetings: Array.isArray(raw?.alternate_greetings)
      ? raw.alternate_greetings
      : undefined,
    creator: raw?.creator,
    character_version: raw?.character_version,
  }
}

/** 提取非标准字段（不在编辑面板中的字段），用于保留完整角色卡信息 */
export function extractExtraFields(raw: any): Record<string, any> {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw.spec === 'chara_card_v2' && raw.data ? raw.data : raw
  const extra: Record<string, any> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!STANDARD_FIELDS.includes(key)) {
      extra[key] = value
    }
  }
  return extra
}

/** 转换为 SillyTavern V2 格式 */
export function toV2Format(
  card: CharacterCard,
  extraFields?: Record<string, any>,
) {
  const data: Record<string, any> = {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.first_mes,
    mes_example: card.mes_example,
    alternate_greetings: card.alternate_greetings ?? [],
    tags: card.tags,
    creator: card.creator ?? '',
    character_version: card.character_version ?? '',
  }
  if (extraFields) {
    Object.assign(data, extraFields)
  }
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
  }
}

// ── JSON 提取 ──────────────────────────────────────────

/** 从 LLM 返回的文本中提取 JSON 对象 */
export function extractJsonFromText(text: string): any | null {
  // 尝试从代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {}
  }
  // 尝试直接解析
  try {
    return JSON.parse(text.trim())
  } catch {}
  // 尝试提取第一个 JSON 对象
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch {}
  }
  return null
}

// ── 图片转 PNG ─────────────────────────────────────────

/** 将图片 URL 转换为 PNG ArrayBuffer（非 PNG 图片通过 canvas 转换） */
export async function imageUrlToPngBuffer(
  url: string,
): Promise<ArrayBuffer> {
  const response = await fetch(url)
  const blob = await response.blob()

  if (blob.type === 'image/png') {
    return await blob.arrayBuffer()
  }

  // 通过 canvas 转换为 PNG
  const img = new Image()
  img.crossOrigin = 'anonymous'
  const objectUrl = URL.createObjectURL(blob)
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas 转 PNG 失败'))
    }, 'image/png')
  })

  return await pngBlob.arrayBuffer()
}

// ── 下载工具 ───────────────────────────────────────────

function getSafeFileName(name: string): string {
  const trimmed = name.trim()
  const safe = trimmed.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)
  return safe || 'character'
}

function getTimestamp(): string {
  return dayjs().format('YYYYMMDD_HHmmss')
}

/** 导出角色卡为 JSON 文件 */
export function exportCardAsJson(
  card: CharacterCard,
  extraFields?: Record<string, any>,
): void {
  const v2 = toV2Format(card, extraFields)
  const json = JSON.stringify(v2, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  saveAs(blob, `${getSafeFileName(card.name)}_${getTimestamp()}.json`)
}

/** 导出角色卡为内嵌 SillyTavern 信息的 PNG 文件 */
export async function exportCardAsPng(
  card: CharacterCard,
  imageUrl: string,
  extraFields?: Record<string, any>,
): Promise<void> {
  const pngBuffer = await imageUrlToPngBuffer(imageUrl)
  const cardBuffer = writePngCharacterCard(pngBuffer, card, extraFields)
  const blob = new Blob([cardBuffer], { type: 'image/png' })
  saveAs(blob, `${getSafeFileName(card.name)}_${getTimestamp()}.png`)
}
