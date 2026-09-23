import { PNG } from 'pngjs'
import { cropAndResizeImage, decodeImageRgba } from '../../common/static/imageProcessor'

const FOCUSED_SIZE = 1024
const DEFAULT_FEATHER_PIXELS = 20

export interface FocusedInpaint {
  left: number
  top: number
  size: number
  image: string
  mask: string
}

function selected(data: Buffer, offset: number) {
  return data[offset] > 127 && data[offset + 1] > 127 && data[offset + 2] > 127 && data[offset + 3] > 127
}

/** Capped, eight-neighbour distance, in original-image pixels. */
function maskDistances(selection: Uint8Array, width: number, height: number, inside: boolean) {
  const distances = new Float32Array(selection.length)
  for (let i = 0; i < selection.length; i++)
    distances[i] = Boolean(selection[i]) === inside ? 65 : 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (x > 0) distances[i] = Math.min(distances[i], distances[i - 1] + 1)
      if (y > 0) {
        distances[i] = Math.min(distances[i], distances[i - width] + 1)
        if (x > 0) distances[i] = Math.min(distances[i], distances[i - width - 1] + Math.SQRT2)
        if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i - width + 1] + Math.SQRT2)
      }
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i + 1] + 1)
      if (y + 1 < height) {
        distances[i] = Math.min(distances[i], distances[i + width] + 1)
        if (x > 0) distances[i] = Math.min(distances[i], distances[i + width - 1] + Math.SQRT2)
        if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i + width + 1] + Math.SQRT2)
      }
    }
  }
  return distances
}

/** Each disconnected selection needs an opaque core, even with a wide feather. */
function featherLimits(selection: Uint8Array, distances: Float32Array, width: number, height: number, requested: number) {
  const limits = new Float32Array(selection.length)
  const queue = new Int32Array(selection.length)
  for (let start = 0; start < selection.length; start++) {
    if (!selection[start] || limits[start]) continue
    let head = 0
    let tail = 1
    let deepest = 0
    queue[0] = start
    limits[start] = -1
    while (head < tail) {
      const i = queue[head++]
      deepest = Math.max(deepest, distances[i])
      const x = i % width
      const visit = (next: number) => {
        if (!selection[next] || limits[next]) return
        limits[next] = -1
        queue[tail++] = next
      }
      if (x > 0) visit(i - 1)
      if (x + 1 < width) visit(i + 1)
      if (i >= width) visit(i - width)
      if (i + width < width * height) visit(i + width)
    }
    const limit = Math.min(requested, Math.max(1, deepest / 2))
    for (let j = 0; j < tail; j++) limits[queue[j]] = limit
  }
  return limits
}

function contextColorOffset(source: Buffer, result: Buffer, outsideDistances: Float32Array) {
  const histograms = Array.from({ length: 3 }, () => new Uint32Array(511))
  let count = 0
  for (let i = 0; i < outsideDistances.length; i++) {
    // Stay clear of resampling across the mask and compare only unchanged context.
    if (outsideDistances[i] < 4 || outsideDistances[i] > 20 || source[i * 4 + 3] < 250 || result[i * 4 + 3] < 250) continue
    for (let c = 0; c < 3; c++) histograms[c][source[i * 4 + c] - result[i * 4 + c] + 255]++
    count++
  }
  if (count < 32) return [0, 0, 0]
  return histograms.map((histogram) => {
    const trim = Math.floor(count * 0.1)
    let seen = 0
    let sum = 0
    for (let i = 0; i < histogram.length; i++) {
      const used = Math.max(0, Math.min(seen + histogram[i], count - trim) - Math.max(seen, trim))
      sum += used * (i - 255)
      seen += histogram[i]
    }
    // Correct modest decoder/model colour drift; do not force a new scene to match.
    return Math.max(-64, Math.min(64, sum / (count - trim * 2)))
  })
}

/** Give a small mask more generation pixels while retaining the surrounding image. */
export async function prepareFocusedInpaint(
  original: Buffer,
  mask: Buffer,
  width: number,
  height: number,
  contextPixels: number,
): Promise<FocusedInpaint | null> {
  const parsed = PNG.sync.read(mask)
  if (parsed.width !== width || parsed.height !== height)
    throw new Error('局部重绘遮罩尺寸与参考图不一致')
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!selected(parsed.data, (y * width + x) * 4)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < 0) throw new Error('局部重绘遮罩为空')

  const padding = Math.max(32, Math.min(512, Math.round(contextPixels)))
  const size = Math.ceil((Math.max(maxX - minX + 1, maxY - minY + 1) + padding * 2) / 2) * 2
  if (size >= Math.min(width, height)) return null
  const even = (value: number) => Math.round(value / 2) * 2
  const left = Math.max(0, Math.min(width - size, even((minX + maxX + 1 - size) / 2)))
  const top = Math.max(0, Math.min(height - size, even((minY + maxY + 1 - size) / 2)))
  const focusedImage = await cropAndResizeImage(original, left, top, size, FOCUSED_SIZE)
  const focusedMask = new PNG({ width: FOCUSED_SIZE, height: FOCUSED_SIZE })
  for (let y = 0; y < FOCUSED_SIZE; y++) {
    const sourceY = top + Math.min(size - 1, Math.floor((y + 0.5) * size / FOCUSED_SIZE))
    for (let x = 0; x < FOCUSED_SIZE; x++) {
      const sourceX = left + Math.min(size - 1, Math.floor((x + 0.5) * size / FOCUSED_SIZE))
      const offset = (y * FOCUSED_SIZE + x) * 4
      const color = selected(parsed.data, (sourceY * width + sourceX) * 4) ? 255 : 0
      focusedMask.data[offset] = color
      focusedMask.data[offset + 1] = color
      focusedMask.data[offset + 2] = color
      focusedMask.data[offset + 3] = 255
    }
  }
  return {
    left,
    top,
    size,
    image: focusedImage.toString('base64'),
    mask: PNG.sync.write(focusedMask).toString('base64'),
  }
}

/** Copy only the requested pixels back, with a short transition inside the mask. */
export async function compositeFocusedInpaint(
  original: Buffer,
  generated: Buffer,
  mask: Buffer,
  width: number,
  height: number,
  focus: FocusedInpaint,
  preserveTransparency = false,
  featherPixels = DEFAULT_FEATHER_PIXELS,
): Promise<Buffer> {
  const parsedMask = PNG.sync.read(mask)
  if (parsedMask.width !== width || parsedMask.height !== height)
    throw new Error('局部重绘遮罩尺寸与参考图不一致')
  const source = await decodeImageRgba(original, width, height)
  const result = await decodeImageRgba(generated, FOCUSED_SIZE, FOCUSED_SIZE)
  const featherWidth = Math.max(4, Math.min(32, Math.round(featherPixels)))
  const selection = new Uint8Array(focus.size * focus.size)
  const sourceCrop = Buffer.alloc(selection.length * 4)
  const resultCrop = Buffer.alloc(selection.length * 4)
  const output = new PNG({ width, height })
  source.copy(output.data)
  for (let y = focus.top; y < focus.top + focus.size; y++) {
    for (let x = focus.left; x < focus.left + focus.size; x++) {
      const index = (y - focus.top) * focus.size + x - focus.left
      const sourceOffset = (y * width + x) * 4
      selection[index] = selected(parsedMask.data, sourceOffset) ? 1 : 0
      source.copy(sourceCrop, index * 4, sourceOffset, sourceOffset + 4)
      const resultX = Math.min(FOCUSED_SIZE - 1, Math.max(0, (x - focus.left + 0.5) * FOCUSED_SIZE / focus.size - 0.5))
      const resultY = Math.min(FOCUSED_SIZE - 1, Math.max(0, (y - focus.top + 0.5) * FOCUSED_SIZE / focus.size - 0.5))
      const x0 = Math.floor(resultX)
      const y0 = Math.floor(resultY)
      const x1 = Math.min(FOCUSED_SIZE - 1, x0 + 1)
      const y1 = Math.min(FOCUSED_SIZE - 1, y0 + 1)
      const tx = resultX - x0
      const ty = resultY - y0
      const sample = (channel: number) => {
        const a = result[(y0 * FOCUSED_SIZE + x0) * 4 + channel]
        const b = result[(y0 * FOCUSED_SIZE + x1) * 4 + channel]
        const c = result[(y1 * FOCUSED_SIZE + x0) * 4 + channel]
        const d = result[(y1 * FOCUSED_SIZE + x1) * 4 + channel]
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
      }
      for (let channel = 0; channel < 4; channel++) resultCrop[index * 4 + channel] = Math.round(sample(channel))
    }
  }
  const distances = maskDistances(selection, focus.size, focus.size, true)
  const limits = featherLimits(selection, distances, focus.size, focus.size, featherWidth)
  const correction = preserveTransparency ? [0, 0, 0] : contextColorOffset(
    sourceCrop, resultCrop, maskDistances(selection, focus.size, focus.size, false),
  )
  for (let y = focus.top; y < focus.top + focus.size; y++) {
    for (let x = focus.left; x < focus.left + focus.size; x++) {
      const index = (y - focus.top) * focus.size + x - focus.left
      if (!selection[index]) continue
      const sourceOffset = (y * width + x) * 4
      const resultOffset = index * 4
      const t = Math.min(1, distances[index] / limits[index])
      const feather = t * t * (3 - 2 * t)
      const opacity = preserveTransparency ? feather : feather * resultCrop[resultOffset + 3] / 255
      for (let channel = 0; channel < 3; channel++) {
        const corrected = Math.max(0, Math.min(255, resultCrop[resultOffset + channel] + correction[channel]))
        output.data[sourceOffset + channel] = Math.round(
          source[sourceOffset + channel] * (1 - opacity) + corrected * opacity,
        )
      }
      if (preserveTransparency) {
        output.data[sourceOffset + 3] = Math.round(
          source[sourceOffset + 3] * (1 - feather) + resultCrop[resultOffset + 3] * feather,
        )
      }
    }
  }
  return PNG.sync.write(output)
}
