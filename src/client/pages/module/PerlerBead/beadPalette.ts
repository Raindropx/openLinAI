import mard from './palettes/mard.json'
import coco from './palettes/coco.json'
import manman from './palettes/manman.json'
import panpan from './palettes/panpan.json'
import mixiaowo from './palettes/mixiaowo.json'
import { hexToRgb } from './processing'
import { ciede2000 } from './colorMatching/ciede2000'
import type { BeadConversion, BeadMatchAlgorithm, BeadPaletteId, CellResult } from './types'

type Coordinates = readonly [number, number, number]
export { ciede2000 as deltaE2000 } from './colorMatching/ciede2000'
interface BeadColor { code: string; hex: string }

// Both MARD versions use the same reference values; the smaller version restricts available codes.
export const BEAD_PALETTES: Record<BeadPaletteId, readonly BeadColor[]> = {
  mard221: mard.filter(({ code }) => /^[A-HM]\d+$/.test(code)),
  mard291: mard,
  coco,
  manman,
  panpan,
  mixiaowo,
}
export const BEAD_PALETTE_NAMES: Record<BeadPaletteId, string> = {
  mard221: 'MARD 221', mard291: 'MARD 291', coco: 'COCO 291',
  manman: '漫漫 278', panpan: '盼盼 285', mixiaowo: '咪小窝 286',
}
export const BEAD_ALGORITHM_NAMES: Record<BeadMatchAlgorithm, string> = { oklab: 'OKLab', ciede2000: 'CIEDE2000', rgb: 'RGB' }

function linearChannel(value: number) {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/** sRGB must be linearized before using the published OKLab matrices. */
export function rgbToOklab(r: number, g: number, b: number): Coordinates {
  const red = linearChannel(r), green = linearChannel(g), blue = linearChannel(b)
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

export function rgbToLab(r: number, g: number, b: number): Coordinates {
  const red = linearChannel(r), green = linearChannel(g), blue = linearChannel(b)
  const f = (value: number) => value > (6 / 29) ** 3 ? Math.cbrt(value) : value / (3 * (6 / 29) ** 2) + 4 / 29
  // CIELAB with the sRGB D65 reference white; both colors use the same white point.
  const x = f((0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047)
  const y = f(0.2126729 * red + 0.7151522 * green + 0.072175 * blue)
  const z = f((0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

export function createBeadMatcher({ paletteId, algorithm }: BeadConversion) {
  const coordinates = (hex: string): Coordinates => {
    const rgb = hexToRgb(hex)
    if (!rgb) throw new Error(`Invalid palette color: ${hex}`)
    const { r, g, b } = rgb
    return algorithm === 'oklab' ? rgbToOklab(r, g, b) : algorithm === 'ciede2000' ? rgbToLab(r, g, b) : [r, g, b]
  }
  const palette = BEAD_PALETTES[paletteId].map((bead) => ({ bead, coordinates: coordinates(bead.hex) }))
  const exact = new Map<string, BeadColor>()
  // Some brands have multiple codes sharing a reference HEX. Use the first for both exact and near matches.
  for (const { bead } of palette) if (!exact.has(bead.hex)) exact.set(bead.hex, bead)
  const cache = new Map<string, BeadColor>()
  return (hex: string) => {
    const key = hex.toUpperCase()
    const known = exact.get(key) ?? cache.get(key)
    if (known) return known
    const color = coordinates(hex)
    let best = palette[0].bead, minDistance = Infinity
    for (const candidate of palette) {
      const target = candidate.coordinates
      const distance = algorithm === 'ciede2000' ? ciede2000(color, target)
        : (color[0] - target[0]) ** 2 + (color[1] - target[1]) ** 2 + (color[2] - target[2]) ** 2
      // Stable palette order chooses one representative when candidates tie.
      if (distance < minDistance) { best = candidate.bead; minDistance = distance }
    }
    cache.set(key, best)
    return best
  }
}

/** Keep the HEX baseline untouched: every comparison and undo is derived from the same cells. */
export function convertBeadCells(cells: CellResult[][] | null, conversion: BeadConversion | null) {
  if (!cells || !conversion) return cells
  const match = createBeadMatcher(conversion)
  return cells.map((row) => row.map((cell) => {
    const bead = match(cell.color)
    return { ...cell, color: bead.hex, beadCode: bead.code }
  }))
}

export function getBeadStats(cells: CellResult[][] | null) {
  const quantities = new Map<string, { color: string; code: string; count: number }>()
  for (const row of cells ?? []) for (const cell of row) {
    if (cell.transparent) continue
    const code = cell.beadCode ?? cell.color
    const entry = quantities.get(code)
    if (entry) entry.count++
    else quantities.set(code, { color: cell.color, code, count: 1 })
  }
  return [...quantities.values()].sort((a, b) => b.count - a.count)
}
