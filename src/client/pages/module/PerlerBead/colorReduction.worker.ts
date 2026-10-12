import { getBeadPalette, reduceImageColors, type ColorReductionOptions } from './colorReduction'

self.onmessage = (event: MessageEvent<{ data: Uint8ClampedArray; options: ColorReductionOptions }>) => {
  try {
    const result = reduceImageColors(event.data.data, event.data.options)
    const palette = getBeadPalette(result.data, event.data.options)
    self.postMessage({ ...result, palette }, { transfer: [result.data.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
