import type { BeadConversion, CellResult } from './types'

// Vendor codes belong to their palette; HEX colors form a separate namespace.
export function getTransparencyKey(cell: CellResult, conversion: BeadConversion | null) {
  return cell.beadCode && conversion
    ? `${conversion.paletteId}:${cell.beadCode}`
    : `hex:${cell.color.toUpperCase()}`
}

/** Apply transparency after bead matching, retaining every cell's original color/code. */
export function applyTransparentColors(cells: CellResult[][] | null, keys: readonly string[], conversion: BeadConversion | null) {
  if (!cells || !keys.length) return cells
  const transparent = new Set(keys)
  return cells.map((row) => row.map((cell) => transparent.has(getTransparencyKey(cell, conversion))
    ? { ...cell, transparent: true }
    : cell))
}
