import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BEAD_PALETTES, convertBeadCells, createBeadMatcher, deltaE2000, getBeadStats, rgbToLab, rgbToOklab } from '../src/client/pages/module/PerlerBead/beadPalette'
import { computeAllCells } from '../src/client/pages/module/PerlerBead/processing'
import { usePerlerBeadStore } from '../src/client/pages/module/PerlerBead/store'
import type { BeadMatchAlgorithm, BeadPaletteId, CellResult } from '../src/client/pages/module/PerlerBead/types'

const close = (actual: number, expected: number, tolerance = 0.0001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)
// Independent published Sharma/Wu/Dalal vectors cover hue wrapping and zero chroma.
const vectors = readFileSync(new URL('./fixtures/ciede2000-sharma.txt', import.meta.url), 'utf8').trim().split(/\r?\n/)
assert.equal(vectors.length, 34)
for (const line of vectors) {
  const [l1, a1, b1, l2, a2, b2, expected] = line.trim().split(/\s+/).map(Number)
  close(deltaE2000([l1, a1, b1], [l2, a2, b2]), expected)
  close(deltaE2000([l2, a2, b2], [l1, a1, b1]), expected)
}
// Published sRGB primary OKLab coordinates (rounded); black and white also test linearization.
for (const [rgb, expected] of [
  [[0, 0, 0], [0, 0, 0]], [[255, 255, 255], [1, 0, 0]],
  [[255, 0, 0], [0.627955, 0.224863, 0.125846]],
  [[0, 255, 0], [0.86644, -0.233888, 0.179498]],
  [[0, 0, 255], [0.452014, -0.032457, -0.311528]],
]) {
  const result = rgbToOklab(rgb[0], rgb[1], rgb[2])
  result.forEach((value, index) => close(value, expected[index]))
}
rgbToLab(255, 255, 255).forEach((value, index) => close(value, [100, 0, 0][index]))
rgbToLab(255, 0, 0).forEach((value, index) => close(value, [53.2408, 80.0925, 67.2032][index]))

const paletteSizes: Record<BeadPaletteId, number> = { mard221: 221, mard291: 291, coco: 291, manman: 278, panpan: 285, mixiaowo: 286 }
const paletteIds = Object.keys(paletteSizes) as BeadPaletteId[]
for (const paletteId of paletteIds) {
  const palette = BEAD_PALETTES[paletteId]
  assert.equal(palette.length, paletteSizes[paletteId])
  assert.equal(new Set(palette.map((bead) => bead.code)).size, palette.length)
  for (const bead of palette) {
    assert.match(bead.hex, /^#[0-9A-F]{6}$/)
    assert.ok(bead.code && bead.code !== '-' && !bead.code.startsWith('UNKNOWN-'), 'Unidentified codes are excluded')
  }
}
for (const bead of BEAD_PALETTES.mard221) assert.ok(BEAD_PALETTES.mard291.some((full) => full.code === bead.code && full.hex === bead.hex))
for (const paletteId of paletteIds) for (const algorithm of ['oklab', 'ciede2000', 'rgb'] as const) {
  const match = createBeadMatcher({ paletteId, algorithm })
  for (const bead of BEAD_PALETTES[paletteId]) {
    const canonical = BEAD_PALETTES[paletteId].find((candidate) => candidate.hex === bead.hex)!
    assert.equal(match(bead.hex.toLowerCase()).code, canonical.code, 'Exact matches consistently choose the first code for duplicate HEX')
  }
  for (const hex of ['#FEDCCC', '#000000', '#FFFFFF', '#808080', '#ff0088']) {
    const result = match(hex)
    assert.ok(BEAD_PALETTES[paletteId].includes(result))
    assert.equal(result.code, BEAD_PALETTES[paletteId].find((bead) => bead.hex === result.hex)!.code, 'Approximate matches also use the canonical code')
    assert.deepEqual(match(hex), result, 'Matching is deterministic')
  }
  const palette = BEAD_PALETTES[paletteId]
  for (const bead of palette.filter((bead, index) => palette.findIndex((other) => other.hex === bead.hex) !== index)) {
    const red = parseInt(bead.hex.slice(1, 3), 16)
    const near = `#${(red === 255 ? red - 1 : red + 1).toString(16).padStart(2, '0')}${bead.hex.slice(3)}`
    const result = match(near)
    assert.equal(result.code, palette.find((other) => other.hex === result.hex)!.code, 'Perturbing duplicate reference colors cannot switch to an alias code')
  }
}
assert.equal(createBeadMatcher({ paletteId: 'coco', algorithm: 'oklab' })('#FFFFFF').code, 'A01', 'Leading zeros in vendor codes survive conversion')

const raw: CellResult[][] = [[
  { row: 0, column: 0, color: '#FFFFFF', sourceColors: [] },
  { row: 0, column: 1, color: '#FEFFFF', sourceColors: [] },
  { row: 0, column: 2, color: '#FFFEFF', sourceColors: [] },
]]
const snapshot = structuredClone(raw)
assert.equal(convertBeadCells(raw, null), raw, 'Default HEX preserves the exact baseline')
const converted = convertBeadCells(raw, { paletteId: 'mard221', algorithm: 'oklab' })!
assert.deepEqual(raw, snapshot, 'Conversion never mutates baseline cells')
assert.equal(getBeadStats(raw).length, 3)
assert.deepEqual(getBeadStats(converted).map(({ code, count }) => [code, count]), [['H2', 3]], 'Different HEX inputs mapping to one bead merge their quantities')
assert.equal(convertBeadCells(null, { paletteId: 'mard291', algorithm: 'rgb' }), null)
for (const paletteId of paletteIds) {
  const result = convertBeadCells(raw, { paletteId, algorithm: 'oklab' })!
  assert.equal(getBeadStats(result).reduce((sum, bead) => sum + bead.count, 0), 3)
  assert.deepEqual(raw, snapshot, 'Switching brands preserves the HEX baseline')
  for (const cell of result[0]) assert.ok(BEAD_PALETTES[paletteId].some((bead) => bead.code === cell.beadCode && bead.hex === cell.color))
}

// Changing algorithms must produce real, independent choices on the same original HEX.
const rgbMatch = createBeadMatcher({ paletteId: 'mard221', algorithm: 'rgb' })
const perceptualMatch = createBeadMatcher({ paletteId: 'mard221', algorithm: 'oklab' })
const deMatch = createBeadMatcher({ paletteId: 'mard221', algorithm: 'ciede2000' })
const comparisonColors = ['#00FF00', '#0000FF', '#FF0000', '#0080FF', '#9933FF', '#00CCCC', '#808000']
assert.ok(comparisonColors.some((hex) => rgbMatch(hex).code !== perceptualMatch(hex).code), 'OKLab is not RGB distance under another name')
assert.ok(comparisonColors.some((hex) => deMatch(hex).code !== perceptualMatch(hex).code), 'CIEDE2000 is independently implemented')
console.log('algorithm comparison', comparisonColors.map((hex) => ({ hex, rgb: rgbMatch(hex).code, oklab: perceptualMatch(hex).code, ciede2000: deMatch(hex).code })))

const state = () => usePerlerBeadStore.getState()
const image = { naturalWidth: 3, naturalHeight: 1 } as HTMLImageElement
const data = { width: 3, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 254, 255, 255, 255, 255, 254, 255, 255]) } as ImageData
state().reset()
state().applyBeadConversion({ paletteId: 'mard221', algorithm: 'oklab' })
assert.equal(state().beadConversion, null, 'No-image conversion is a no-op')
state().setImage('test:bead-source', image, data, { columns: 3, rows: 1 })
state().setCellOverride(0, 0, { color: '#A83232' })
const cells = () => {
  const current = state()
  return convertBeadCells(computeAllCells(current.imageData!, current.gridSize, current.globalRule, current.cellOverrides, current.sourcePalette), current.beadConversion)
}
const originalCells = cells()
const originalOverrides = structuredClone(state().cellOverrides)
const hexState = { imageUrl: state().imageUrl, sourcePalette: state().sourcePalette, sourceHistory: [...state().sourceHistory] }
for (const algorithm of ['oklab', 'ciede2000', 'rgb'] as BeadMatchAlgorithm[]) state().applyBeadConversion({ paletteId: 'mard221', algorithm })
state().applyBeadConversion({ paletteId: 'mard291', algorithm: 'rgb' })
assert.equal(state().beadConversionHistory.length, 4)
state().applyBeadConversion({ paletteId: 'mard291', algorithm: 'rgb' })
assert.equal(state().beadConversionHistory.length, 4, 'Identical conversion does not add an undo entry')
state().undoBeadConversion()
assert.deepEqual(state().beadConversion, { paletteId: 'mard221', algorithm: 'rgb' })
state().undoBeadConversion()
assert.deepEqual(state().beadConversion, { paletteId: 'mard221', algorithm: 'ciede2000' })
state().undoBeadConversion()
state().undoBeadConversion()
assert.deepEqual(cells(), originalCells, 'Undo restores exact pre-conversion colors, including cell overrides')
assert.deepEqual(state().cellOverrides, originalOverrides)
assert.deepEqual({ imageUrl: state().imageUrl, sourcePalette: state().sourcePalette, sourceHistory: state().sourceHistory }, hexState)
for (const paletteId of paletteIds) {
  state().applyBeadConversion({ paletteId, algorithm: 'oklab' })
  const expected = convertBeadCells(originalCells, { paletteId, algorithm: 'oklab' })
  assert.deepEqual(cells(), expected, 'Each brand is matched against the original HEX rather than the previous brand')
}
for (const paletteId of [...paletteIds].reverse()) {
  assert.deepEqual(state().beadConversion, { paletteId, algorithm: 'oklab' })
  state().undoBeadConversion()
}
assert.deepEqual(cells(), originalCells, 'Undo across brands restores the exact HEX baseline')
state().commitEditedImage('test:reduced-source', image, data, ['#FFFFFF', '#000000'])
const reducedCells = cells()
state().applyBeadConversion({ paletteId: 'mard291', algorithm: 'oklab' })
state().undoBeadConversion()
assert.deepEqual(cells(), reducedCells, 'Undo retains an existing reduced source palette')
assert.deepEqual(state().sourcePalette, ['#FFFFFF', '#000000'])
state().applyBeadConversion({ paletteId: 'mard291', algorithm: 'oklab' })
state().setImage('test:new-source', image, data)
assert.equal(state().beadConversion, null)
assert.deepEqual(state().beadConversionHistory, [])
state().reset()
console.log('PASS: palette integrity, 34 CIEDE2000 reference vectors, OKLab/Lab reference coordinates, code grouping, independent algorithms, exact undo and source reset')
