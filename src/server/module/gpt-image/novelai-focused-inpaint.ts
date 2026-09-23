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
  return data[offset] > 127 && data[offset + 1] > 127 && data[offset + 2] > 127
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
  const distances = new Uint16Array(width * height)
  for (let y = focus.top; y < focus.top + focus.size; y++) {
    for (let x = focus.left; x < focus.left + focus.size; x++) {
      const index = y * width + x
      if (!selected(parsedMask.data, index * 4)) continue
      distances[index] = featherWidth
      if (x > 0) distances[index] = Math.min(distances[index], distances[index - 1] + 1)
      if (y > 0) distances[index] = Math.min(distances[index], distances[index - width] + 1)
    }
  }
  for (let y = focus.top + focus.size - 1; y >= focus.top; y--) {
    for (let x = focus.left + focus.size - 1; x >= focus.left; x--) {
      const index = y * width + x
      if (!distances[index]) continue
      if (x + 1 < width) distances[index] = Math.min(distances[index], distances[index + 1] + 1)
      if (y + 1 < height) distances[index] = Math.min(distances[index], distances[index + width] + 1)
    }
  }
  const output = new PNG({ width, height })
  source.copy(output.data)
  for (let y = focus.top; y < focus.top + focus.size; y++) {
    for (let x = focus.left; x < focus.left + focus.size; x++) {
      const index = y * width + x
      if (!distances[index]) continue
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
      const sourceOffset = index * 4
      const feather = distances[index] / featherWidth
      const opacity = preserveTransparency ? feather : feather * sample(3) / 255
      for (let channel = 0; channel < 3; channel++) {
        output.data[sourceOffset + channel] = Math.round(
          source[sourceOffset + channel] * (1 - opacity) + sample(channel) * opacity,
        )
      }
      if (preserveTransparency) {
        output.data[sourceOffset + 3] = Math.round(
          source[sourceOffset + 3] * (1 - feather) + sample(3) * feather,
        )
      }
    }
  }
  return PNG.sync.write(output)
}
