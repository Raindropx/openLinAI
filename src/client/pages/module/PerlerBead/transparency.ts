import type { BeadConversion, CellResult } from './types'

export type TransparentCellOverrides = Record<string, Record<string, boolean>>

// Vendor codes belong to their palette; HEX colors form a separate namespace.
export function getTransparencyKey(cell: CellResult, conversion: BeadConversion | null) {
  return cell.beadCode && conversion
    ? `${conversion.paletteId}:${cell.beadCode}`
    : `hex:${cell.color.toUpperCase()}`
}

/** Apply transparency after bead matching, retaining every cell's original color/code. */
export function applyTransparentColors(cells: CellResult[][] | null, keys: readonly string[], conversion: BeadConversion | null, overrides: TransparentCellOverrides = {}) {
  if (!cells || (!keys.length && !Object.keys(overrides).length)) return cells
  const transparent = new Set(keys)
  return cells.map((row) => row.map((cell) => {
    const key = getTransparencyKey(cell, conversion)
    const hidden = overrides[key]?.[`${cell.row},${cell.column}`] ?? transparent.has(key)
    return hidden ? { ...cell, transparent: true } : cell
  }))
}

/** Flood fill by original color/code and current transparency, using four neighbors. */
export function getConnectedColorRegion(cells: CellResult[][], row: number, column: number, conversion: BeadConversion | null) {
  const selected = cells[row]?.[column]
  if (!selected) return []
  const key = getTransparencyKey(selected, conversion)
  const region: CellResult[] = []
  const visited = new Set<string>()
  const pending = [[row, column]]
  while (pending.length) {
    const [r, c] = pending.pop()!
    const position = `${r},${c}`
    if (visited.has(position)) continue
    visited.add(position)
    const cell = cells[r]?.[c]
    if (!cell || getTransparencyKey(cell, conversion) !== key || !!cell.transparent !== !!selected.transparent) continue
    region.push(cell)
    pending.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1])
  }
  return region
}
