import { PNG } from 'pngjs'
import { cropAndResizeImage, decodeImageRgba } from '../../common/static/imageProcessor'

const FOCUSED_SIZE = 1024
const DEFAULT_FEATHER_PIXELS = 20

export interface FocusedInpaint {
  left: number
  top: number
  width: number
  height: number
  targetWidth: number
  targetHeight: number
  image: string
  mask: string
}

type BlendMode = 'strict' | 'soft'

const featherRadius = (pixels: number) => Math.max(4, Math.min(32, Math.round(pixels)))

/** Keep the painted selection opaque, then feather only the outer edge of its halo. */
function controlledSoftBlendMask(selection: Uint8Array, width: number, height: number, reach: number, featherPixels: number) {
  const distances = maskDistances(selection, width, height, false)
  const feather = Math.max(0, Math.min(reach, Math.round(featherPixels)))
  const weights = new Float32Array(selection.length)
  for (let i = 0; i < selection.length; i++) {
    if (selection[i]) {
      weights[i] = 1
      continue
    }
    const distance = distances[i]
    if (distance > reach) continue
    if (feather === 0 || distance <= reach - feather) {
      weights[i] = 1
      continue
    }
    const t = (reach - distance) / feather
    weights[i] = t * t * (3 - 2 * t)
  }
  return weights
}

/** Finite Gaussian support on both sides of the boundary; radius is in source pixels.
 * Clamp to the canvas edge so selections touching it do not gain artificial seams.
 */
function softBlendMask(selection: Uint8Array, width: number, height: number, radius: number) {
  const kernel = new Float64Array(radius * 2 + 1)
  const sigma = radius / 2
  let total = 0
  for (let d = -radius; d <= radius; d++) {
    const weight = Math.exp(-d * d / (2 * sigma * sigma))
    kernel[d + radius] = weight
    total += weight
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total
  const horizontal = new Float32Array(selection.length)
  const output = new Float32Array(selection.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    if (!selection.subarray(row, row + width).some(Boolean)) continue
    for (let x = 0; x < width; x++) {
      let value = 0
      for (let d = -radius; d <= radius; d++)
        value += selection[row + Math.max(0, Math.min(width - 1, x + d))] * kernel[d + radius]
      horizontal[row + x] = value
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let value = 0
      for (let d = -radius; d <= radius; d++)
        value += horizontal[Math.max(0, Math.min(height - 1, y + d)) * width + x] * kernel[d + radius]
      output[y * width + x] = Math.min(1, value)
    }
  }
  return output
}

function cropSelection(mask: PNG, left: number, top: number, width: number, height: number) {
  const selection = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      selection[y * width + x] = selected(mask.data, ((top + y) * mask.width + left + x) * 4) ? 1 : 0
  }
  return selection
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

function resampleFocusedResult(result: Buffer, focus: FocusedInpaint) {
  const resultCrop = Buffer.alloc(focus.width * focus.height * 4)
  for (let y = 0; y < focus.height; y++) {
    for (let x = 0; x < focus.width; x++) {
      const index = y * focus.width + x
      const resultX = Math.min(focus.targetWidth - 1, Math.max(0, (x + 0.5) * focus.targetWidth / focus.width - 0.5))
      const resultY = Math.min(focus.targetHeight - 1, Math.max(0, (y + 0.5) * focus.targetHeight / focus.height - 0.5))
      const x0 = Math.floor(resultX)
      const y0 = Math.floor(resultY)
      const x1 = Math.min(focus.targetWidth - 1, x0 + 1)
      const y1 = Math.min(focus.targetHeight - 1, y0 + 1)
      const tx = resultX - x0
      const ty = resultY - y0
      for (let channel = 0; channel < 4; channel++) {
        const a = result[(y0 * focus.targetWidth + x0) * 4 + channel]
        const b = result[(y0 * focus.targetWidth + x1) * 4 + channel]
        const c = result[(y1 * focus.targetWidth + x0) * 4 + channel]
        const d = result[(y1 * focus.targetWidth + x1) * 4 + channel]
        resultCrop[index * 4 + channel] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty)
      }
    }
  }
  return resultCrop
}

/** Give a small mask more generation pixels while retaining the surrounding image. */
export async function prepareFocusedInpaint(
  original: Buffer,
  mask: Buffer,
  width: number,
  height: number,
  contextPixels: number,
  blendMode: BlendMode = 'strict',
  featherPixels = DEFAULT_FEATHER_PIXELS,
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
  const radius = blendMode === 'soft' ? featherRadius(featherPixels) : 0
  // Include the whole soft transition in the generation mask as well as the crop.
  const size = Math.ceil((Math.max(maxX - minX + 1, maxY - minY + 1) + (padding + radius) * 2) / 2) * 2
  const wholeImage = size >= Math.min(width, height)
  if (wholeImage && blendMode === 'strict') return null
  const even = (value: number) => Math.round(value / 2) * 2
  const left = wholeImage ? 0 : Math.max(0, Math.min(width - size, even((minX + maxX + 1 - size) / 2)))
  const top = wholeImage ? 0 : Math.max(0, Math.min(height - size, even((minY + maxY + 1 - size) / 2)))
  const cropWidth = wholeImage ? width : size
  const cropHeight = wholeImage ? height : size
  const targetWidth = wholeImage ? width : FOCUSED_SIZE
  const targetHeight = wholeImage ? height : FOCUSED_SIZE
  const focusedImage = wholeImage ? original : await cropAndResizeImage(original, left, top, size, FOCUSED_SIZE)
  const selection = cropSelection(parsed, left, top, cropWidth, cropHeight)
  const support = blendMode === 'soft' ? softBlendMask(selection, cropWidth, cropHeight, radius) : selection
  const focusedMask = new PNG({ width: targetWidth, height: targetHeight })
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.min(cropHeight - 1, Math.floor((y + 0.5) * cropHeight / targetHeight))
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.min(cropWidth - 1, Math.floor((x + 0.5) * cropWidth / targetWidth))
      const offset = (y * targetWidth + x) * 4
      const color = support[sourceY * cropWidth + sourceX] > 0 ? 255 : 0
      focusedMask.data[offset] = color
      focusedMask.data[offset + 1] = color
      focusedMask.data[offset + 2] = color
      focusedMask.data[offset + 3] = 255
    }
  }
  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight,
    targetWidth,
    targetHeight,
    image: focusedImage.toString('base64'),
    mask: PNG.sync.write(focusedMask).toString('base64'),
  }
}

/** Strict mode keeps every unselected pixel; soft mode blends within a finite halo. */
export async function compositeFocusedInpaint(
  original: Buffer,
  generated: Buffer,
  mask: Buffer,
  width: number,
  height: number,
  focus: FocusedInpaint,
  preserveTransparency = false,
  featherPixels = DEFAULT_FEATHER_PIXELS,
  blendMode: BlendMode = 'strict',
  edgeFeatherPixels?: number,
): Promise<Buffer> {
  const parsedMask = PNG.sync.read(mask)
  if (parsedMask.width !== width || parsedMask.height !== height)
    throw new Error('局部重绘遮罩尺寸与参考图不一致')
  const source = await decodeImageRgba(original, width, height)
  const result = await decodeImageRgba(generated, focus.targetWidth, focus.targetHeight)
  const featherWidth = featherRadius(featherPixels)
  const selection = cropSelection(parsedMask, focus.left, focus.top, focus.width, focus.height)
  const sourceCrop = Buffer.alloc(selection.length * 4)
  const resultCrop = resampleFocusedResult(result, focus)
  const output = new PNG({ width, height })
  source.copy(output.data)
  for (let y = focus.top; y < focus.top + focus.height; y++) {
    for (let x = focus.left; x < focus.left + focus.width; x++) {
      const index = (y - focus.top) * focus.width + x - focus.left
      const sourceOffset = (y * width + x) * 4
      source.copy(sourceCrop, index * 4, sourceOffset, sourceOffset + 4)
    }
  }
  const weights = blendMode === 'soft'
    ? edgeFeatherPixels === undefined
      ? softBlendMask(selection, focus.width, focus.height, featherWidth)
      : controlledSoftBlendMask(selection, focus.width, focus.height, featherWidth, edgeFeatherPixels)
    : null
  const distances = weights ? null : maskDistances(selection, focus.width, focus.height, true)
  const limits = distances ? featherLimits(selection, distances, focus.width, focus.height, featherWidth) : null
  // Expanded generation pixels are not unchanged context and must not calibrate colour.
  const generatedSelection = weights ? Uint8Array.from(weights, (weight) => weight > 0 ? 1 : 0) : selection
  const correction = preserveTransparency ? [0, 0, 0] : contextColorOffset(
    sourceCrop, resultCrop, maskDistances(generatedSelection, focus.width, focus.height, false),
  )
  for (let y = focus.top; y < focus.top + focus.height; y++) {
    for (let x = focus.left; x < focus.left + focus.width; x++) {
      const index = (y - focus.top) * focus.width + x - focus.left
      if (!generatedSelection[index]) continue
      const sourceOffset = (y * width + x) * 4
      const resultOffset = index * 4
      const t = weights ? 0 : Math.min(1, distances![index] / limits![index])
      const feather = weights ? weights[index] : t * t * (3 - 2 * t)
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

/** Place the complete upstream result at its source-image crop, without masking or feathering it. */
export async function manualFocusedInpaintLayer(
  generated: Buffer,
  width: number,
  height: number,
  focus: FocusedInpaint,
): Promise<Buffer> {
  const generatedRgba = await decodeImageRgba(generated, focus.targetWidth, focus.targetHeight)
  const resultCrop = resampleFocusedResult(generatedRgba, focus)
  const layer = new PNG({ width, height })
  layer.data.fill(0)
  for (let y = 0; y < focus.height; y++) {
    for (let x = 0; x < focus.width; x++) {
      const index = y * focus.width + x
      const from = index * 4
      const to = ((focus.top + y) * width + focus.left + x) * 4
      resultCrop.copy(layer.data, to, from, from + 4)
    }
  }
  return PNG.sync.write(layer)
}
