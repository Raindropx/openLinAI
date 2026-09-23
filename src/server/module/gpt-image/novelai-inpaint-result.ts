import { PNG } from 'pngjs'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function pngChunks(buffer: Buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('无效的 PNG 文件')
  const chunks: Array<{ type: string; bytes: Buffer }> = []
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const size = buffer.readUInt32BE(offset)
    const end = offset + 12 + size
    if (end > buffer.length) throw new Error('PNG 文件不完整')
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    chunks.push({ type, bytes: buffer.subarray(offset, end) })
    offset = end
    if (type === 'IEND') return chunks
  }
  throw new Error('PNG 文件缺少结束标记')
}

/** Replace only PNG pixel data so NovelAI's original metadata stays intact. */
function replacePngPixels(original: Buffer, updated: Buffer) {
  if (!original.subarray(16, 29).equals(updated.subarray(16, 29)))
    throw new Error('局部重绘 PNG 像素格式发生变化')
  const replacement = pngChunks(updated)
    .filter((chunk) => chunk.type === 'IDAT')
    .map((chunk) => chunk.bytes)
  if (!replacement.length) throw new Error('局部重绘 PNG 缺少像素数据')
  const output: Buffer[] = [PNG_SIGNATURE]
  let inserted = false
  for (const chunk of pngChunks(original)) {
    if (chunk.type === 'IDAT') {
      if (!inserted) output.push(...replacement)
      inserted = true
    } else {
      output.push(chunk.bytes)
    }
  }
  if (!inserted) throw new Error('局部重绘 PNG 缺少像素数据')
  return Buffer.concat(output)
}

/** V5 can return partially transparent pixels inside a mask without an alpha prompt. */
export function makeNovelAIInpaintOpaque(image: Buffer, mask: Buffer, prompt: string) {
  if (/\b(?:transparent background|has alpha|alpha transparency)\b/i.test(prompt)) return image
  if (!image.subarray(0, 8).equals(PNG_SIGNATURE) || image[25] !== 6) return image
  const result = PNG.sync.read(image)
  const selected = PNG.sync.read(mask)
  if (result.width !== selected.width || result.height !== selected.height)
    throw new Error('局部重绘结果与遮罩尺寸不一致')

  let changed = false
  for (let offset = 0; offset < result.data.length; offset += 4) {
    if (selected.data[offset] > 127 && selected.data[offset + 1] > 127 &&
      selected.data[offset + 2] > 127 && result.data[offset + 3] < 255) {
      result.data[offset + 3] = 255
      changed = true
    }
  }
  if (!changed) return image
  return replacePngPixels(image, PNG.sync.write(result, { colorType: 6 }))
}
