import assert from 'node:assert/strict'
import { convertBeadCells, getBeadStats } from '../src/client/pages/module/PerlerBead/beadPalette'
import { usePerlerBeadStore } from '../src/client/pages/module/PerlerBead/store'
import { applyTransparentColors, getTransparencyKey } from '../src/client/pages/module/PerlerBead/transparency'
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
console.log('PASS: all matching HEX/code cells, reversible original colors, independent palette identities, conversion undo, zero-bead stats and source/reset cleanup')
