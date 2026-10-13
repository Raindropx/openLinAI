import assert from 'node:assert/strict'
import { convertBeadCells, getBeadStats } from '../src/client/pages/module/PerlerBead/beadPalette'
import { usePerlerBeadStore } from '../src/client/pages/module/PerlerBead/store'
import { applyTransparentColors, getConnectedColorRegion, getTransparencyKey } from '../src/client/pages/module/PerlerBead/transparency'
import type { CellResult } from '../src/client/pages/module/PerlerBead/types'

const raw: CellResult[][] = [[
  { row: 0, column: 0, color: '#FFFFFF', sourceColors: [] },
  { row: 0, column: 1, color: '#FEFFFF', sourceColors: [] },
  { row: 0, column: 2, color: '#FF0000', sourceColors: [] },
  { row: 0, column: 3, color: '#FFFFFF', sourceColors: [] },
]]
const original = structuredClone(raw)
const state = () => usePerlerBeadStore.getState()
const image = { naturalWidth: 4, naturalHeight: 1 } as HTMLImageElement
const data = { width: 4, height: 1 } as ImageData
state().setImage('test:transparency', image, data, { columns: 4, rows: 1 })

const hexKey = getTransparencyKey(raw[0][0], null)
state().toggleTransparentColor(hexKey)
const transparentHex = applyTransparentColors(raw, state().transparentColorKeys, null)!
assert.deepEqual(transparentHex[0].map((cell) => !!cell.transparent), [true, false, false, true], 'HEX mode affects every exact color match, not adjacent shades')
assert.equal(getBeadStats(transparentHex).reduce((sum, item) => sum + item.count, 0), 2)
state().toggleTransparentColor(getTransparencyKey(transparentHex[0][3], null))
assert.deepEqual(applyTransparentColors(raw, state().transparentColorKeys, null), original, 'Selecting another transparent cell restores the whole color group')

const conversion = { paletteId: 'mard221', algorithm: 'oklab' } as const
state().applyBeadConversion(conversion)
const matched = convertBeadCells(raw, conversion)!
const matchedSnapshot = structuredClone(matched)
state().toggleTransparentColor(getTransparencyKey(matched[0][0], conversion))
const masked = applyTransparentColors(matched, state().transparentColorKeys, conversion)!
assert.deepEqual(masked[0].map((cell) => !!cell.transparent), [true, true, false, true], 'Different source colors matched to the same bead code become transparent together')
assert.equal(getBeadStats(masked).reduce((sum, item) => sum + item.count, 0), 1)
assert.deepEqual(matched, matchedSnapshot, 'Transparency never erases original colors or bead codes')
assert.deepEqual(raw, original, 'The HEX baseline remains untouched')
assert.notEqual(getTransparencyKey(matched[0][0], conversion), getTransparencyKey(matched[0][0], { paletteId: 'coco', algorithm: 'oklab' }), 'Vendor code identities are scoped to their palette')
state().undoBeadConversion()
assert.deepEqual(applyTransparentColors(raw, state().transparentColorKeys, null), original, 'Undo to HEX does not accidentally match a vendor code')
state().applyBeadConversion(conversion)
assert.deepEqual(applyTransparentColors(matched, state().transparentColorKeys, conversion), masked, 'Returning to a palette retains its transparent color choices')
state().toggleTransparentColor(getTransparencyKey(masked[0][1], conversion))
assert.deepEqual(applyTransparentColors(matched, state().transparentColorKeys, conversion), matchedSnapshot, 'Restoring through any cell of the code recovers the exact matched colors')
for (const cell of matched[0]) {
  const key = getTransparencyKey(cell, conversion)
  if (!state().transparentColorKeys.includes(key)) state().toggleTransparentColor(key)
}
assert.deepEqual(getBeadStats(applyTransparentColors(matched, state().transparentColorKeys, conversion)), [], 'All colors can be transparent with zero beads')
state().setImage('test:replacement', image, data)
assert.deepEqual(state().transparentColorKeys, [], 'Loading another image clears transparency choices')
state().toggleTransparentColor(hexKey)
state().reset()
assert.deepEqual(state().transparentColorKeys, [], 'Reset clears transparency choices')
const islands: CellResult[][] = [
  ['#FFFFFF', '#FFFFFF', '#FF0000', '#FFFFFF'],
  ['#FFFFFF', '#FF0000', '#FFFFFF', '#FFFFFF'],
  ['#FF0000', '#FFFFFF', '#FF0000', '#FF0000'],
].map((row, r) => row.map((color, column) => ({ row: r, column, color, sourceColors: [] })))
const islandsSnapshot = structuredClone(islands)
const visible = (baseline: CellResult[][]) => applyTransparentColors(baseline, state().transparentColorKeys, state().beadConversion, state().transparentCellOverrides)!
const mask = (cells: CellResult[][]) => cells.map((row) => row.map((cell) => !!cell.transparent))
state().setImage('test:regions', image, data, { columns: 4, rows: 3 })
state().toggleTransparentRegion(visible(islands), 0, 0)
assert.deepEqual(mask(visible(islands)), [
  [true, true, false, false],
  [true, false, false, false],
  [false, false, false, false],
], 'Bucket follows an L-shaped region without crossing a color boundary or diagonal contact')
assert.equal(getBeadStats(visible(islands)).reduce((sum, item) => sum + item.count, 0), 9, 'Only the filled region is excluded from bead counts')
state().toggleTransparentRegion(visible(islands), 1, 0)
assert.deepEqual(visible(islands), islandsSnapshot, 'Restoring from another cell in the region recovers original colors')
assert.deepEqual(state().transparentCellOverrides, {}, 'Restoring a region removes redundant overrides')

state().toggleTransparentColor(hexKey)
state().toggleTransparentRegion(visible(islands), 0, 3)
assert.deepEqual(mask(visible(islands)), [
  [true, true, false, false],
  [true, false, false, false],
  [false, true, false, false],
], 'Bucket can restore one island while disconnected globally transparent islands stay hidden')
state().toggleTransparentColor(hexKey, true)
assert.equal(visible(islands).flat().filter((cell) => cell.transparent).length, 7, 'Global hide clears local restore exceptions')
state().toggleTransparentRegion(visible(islands), 0, 0)
state().toggleTransparentColor(hexKey, false)
assert.deepEqual(visible(islands), islandsSnapshot, 'Global restore clears local transparency exceptions')

state().applyBeadConversion(conversion)
const beadIslands = convertBeadCells(islands.map((row) => row.map((cell) => cell.row === 0 && cell.column === 1 ? { ...cell, color: '#FEFFFF' } : cell)), conversion)!
const beadSnapshot = structuredClone(beadIslands)
state().toggleTransparentRegion(visible(beadIslands), 0, 0)
assert.equal(visible(beadIslands).flat().filter((cell) => cell.transparent).length, 3, 'Bucket joins adjacent source shades matched to the same bead code')
state().undoBeadConversion()
assert.deepEqual(visible(islands), islandsSnapshot, 'Palette region masks do not leak into HEX mode')
state().applyBeadConversion(conversion)
assert.equal(visible(beadIslands).flat().filter((cell) => cell.transparent).length, 3, 'Palette region choices survive conversion undo and return')
state().toggleTransparentRegion(visible(beadIslands), 0, 1)
assert.deepEqual(visible(beadIslands), beadSnapshot, 'Bucket restore preserves exact matched colors and bead codes')
assert.deepEqual(islands, islandsSnapshot, 'Region operations never mutate source cells')

state().undoBeadConversion()
state().toggleTransparentRegion(visible(islands), 0, 3)
state().setGridSize({ columns: 2, rows: 3 })
assert.deepEqual(state().transparentCellOverrides, {}, 'Shrinking the grid discards region overrides outside it')
state().toggleTransparentRegion(visible(islands), 0, 0)
state().setImage('test:region-replacement', image, data)
assert.deepEqual(state().transparentCellOverrides, {}, 'Replacing the image clears region overrides')
state().toggleTransparentRegion(visible(islands), 0, 0)
state().reset()
assert.deepEqual(state().transparentCellOverrides, {}, 'Reset clears region overrides')
assert.deepEqual(getConnectedColorRegion(islands, -1, 0, null), [], 'Out-of-bounds selection is harmless')
const large = Array.from({ length: 200 }, (_, row) => Array.from({ length: 200 }, (_, column) => ({ row, column, color: '#FFFFFF', sourceColors: [] })))
assert.equal(getConnectedColorRegion(large, 0, 0, null).length, 40000, 'Large connected regions fill without recursive stack overflow')
console.log('PASS: global transparency, four-neighbor regions, reversible HEX/bead colors, mixed global/bucket operations, palette isolation, bead counts, grid/source/reset cleanup and large fills')
