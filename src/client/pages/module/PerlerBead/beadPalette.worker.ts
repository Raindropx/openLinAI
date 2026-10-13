import { createBeadMatcher } from './beadPalette'
import type { BeadConversion } from './types'

self.onmessage = (event: MessageEvent<{ colors: string[]; conversion: BeadConversion }>) => {
  try {
    const match = createBeadMatcher(event.data.conversion)
    self.postMessage({ mapping: event.data.colors.map((color) => [color, match(color)]) })
  } catch {
    self.postMessage({ error: true })
  }
}
