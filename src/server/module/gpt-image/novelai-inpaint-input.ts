import { PNG } from 'pngjs'
import { decodeImageRgba } from '../../common/static/imageProcessor'

/** Blur only the provider's masked input; callers retain the original for compositing. */
export async function blurNovelAIInpaintInput(image: Buffer, mask: Buffer, width: number, height: number) {
  const selection = PNG.sync.read(mask)
  if (selection.width !== width || selection.height !== height)
    throw new Error('局部重绘遮罩尺寸与参考图不一致')

  const source = await decodeImageRgba(image, width, height)
  const horizontal = new Float32Array(source.length)
  const output = new PNG({ width, height })
  source.copy(output.data)
  const radius = Math.max(12, Math.min(48, Math.round(Math.min(width, height) * 0.024)))

  // Average premultiplied colors so transparent pixels cannot tint the blur.
  for (let y = 0; y < height; y++) {
    let left = 0
    let right = -1
    const sums = [0, 0, 0, 0]
    for (let x = 0; x < width; x++) {
      while (right < Math.min(width - 1, x + radius)) {
        const offset = (y * width + ++right) * 4
        const alpha = source[offset + 3] / 255
        for (let channel = 0; channel < 3; channel++) sums[channel] += source[offset + channel] * alpha
        sums[3] += alpha
      }
      while (left < x - radius) {
        const offset = (y * width + left++) * 4
        const alpha = source[offset + 3] / 255
        for (let channel = 0; channel < 3; channel++) sums[channel] -= source[offset + channel] * alpha
        sums[3] -= alpha
      }
      const offset = (y * width + x) * 4
      const count = right - left + 1
      for (let channel = 0; channel < 4; channel++) horizontal[offset + channel] = sums[channel] / count
    }
  }

  for (let x = 0; x < width; x++) {
    let top = 0
    let bottom = -1
    const sums = [0, 0, 0, 0]
    for (let y = 0; y < height; y++) {
      while (bottom < Math.min(height - 1, y + radius)) {
        const offset = (++bottom * width + x) * 4
        for (let channel = 0; channel < 4; channel++) sums[channel] += horizontal[offset + channel]
      }
      while (top < y - radius) {
        const offset = (top++ * width + x) * 4
        for (let channel = 0; channel < 4; channel++) sums[channel] -= horizontal[offset + channel]
      }
      const offset = (y * width + x) * 4
      if (selection.data[offset] <= 127 || selection.data[offset + 1] <= 127 ||
        selection.data[offset + 2] <= 127 || selection.data[offset + 3] <= 127) continue
      const alpha = sums[3]
      if (alpha <= 0) continue
      for (let channel = 0; channel < 3; channel++)
        output.data[offset + channel] = Math.round(sums[channel] / alpha)
    }
  }
  return PNG.sync.write(output)
}
