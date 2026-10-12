import assert from 'node:assert/strict'
import { getBeadPalette, reduceImageColors } from '../src/client/pages/module/PerlerBead/colorReduction'
import { computeAllCells, getImageDataFromImage } from '../src/client/pages/module/PerlerBead/processing'
import { getEditedImageSize, getEditedPalette } from '../src/client/pages/common/TemplateSection/TemplateForm/ImageEdit/imageEditor'

const pixels = (...colors: number[][]) => new Uint8ClampedArray(colors.flat())
const whites = pixels([242, 246, 240, 255], [239, 239, 237, 255], [237, 237, 235, 255], [242, 246, 240, 255], [0, 0, 0, 255])
const optimized = reduceImageColors(whites.slice(), { mode: 'threshold', value: 12 })
assert.equal(optimized.before, 4)
assert.equal(optimized.after, 2)
for (let i = 0; i < 16; i += 4) assert.deepEqual([...optimized.data.slice(i, i + 3)], [242, 246, 240])
assert.deepEqual([...optimized.data.slice(16)], [0, 0, 0, 255])
assert.deepEqual(reduceImageColors(whites.slice(), { mode: 'threshold', value: 0 }).data, whites)
assert.equal(reduceImageColors(whites.slice(), { mode: 'count', value: 128 }).after, 4)
const contrasted = reduceImageColors(pixels(...Array.from({ length: 6 * 22 }, (_, i) => [
  [242, 246, 240, 255], [239, 239, 237, 255], [237, 237, 235, 255], [0, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255],
][Math.floor(i / 22)])), { mode: 'count', value: 2 })
assert.notDeepEqual([...contrasted.data.slice(0, 3)], [...contrasted.data.slice(3 * 22 * 4, 3 * 22 * 4 + 3)], 'A tiny palette preserves dark regions instead of choosing two near-white representatives')

const chain = reduceImageColors(pixels([0, 0, 0, 255], [10, 0, 0, 255], [20, 0, 0, 255]), { mode: 'threshold', value: 10 })
assert.equal(chain.after, 2, 'Threshold matching does not chain black through intermediate colors')
const alpha = pixels([255, 0, 0, 0], [0, 100, 0, 128], [0, 105, 0, 255])
const transparent = reduceImageColors(alpha.slice(), { mode: 'threshold', value: 12 })
assert.equal(transparent.before, 2)
assert.equal(transparent.after, 1)
assert.deepEqual([...transparent.data.filter((_, i) => i % 4 === 3)], [0, 128, 255])
assert.deepEqual([...transparent.data.slice(0, 4)], [255, 0, 0, 0], 'Fully transparent RGB bytes remain untouched')
const varyingAlpha = pixels(...Array.from({ length: 256 }, (_, i) => [0, 0, 0, i]))
const visiblePalette = getBeadPalette(varyingAlpha, { mode: 'count', value: 16 })
assert.equal(visiblePalette.length, 16, 'Alpha shades are also reduced to the bead palette budget')
const alphaImage = { width: 256, height: 1, data: varyingAlpha } as ImageData
for (const type of ['center', 'dominant'] as const) {
  const allCells = computeAllCells(alphaImage, { columns: 128, rows: 1 }, { type, offsetX: 0.5, offsetY: 0.5 }, { '0,0': { color: '#FF0000' } }, visiblePalette)
  const colors = new Set(allCells.flat().map((cell) => cell.color))
  assert.ok(colors.size <= 16, 'Sampling and overrides cannot exceed the reduced palette')
  assert.ok([...colors].every((color) => visiblePalette.includes(color)))
}
assert.ok(new Set(computeAllCells(alphaImage, { columns: 128, rows: 1 }, { type: 'center', offsetX: 0.5, offsetY: 0.5 }, {}).flat().map((cell) => cell.color)).size > 16, 'The fixture reproduces the previously excessive bead colors')
assert.deepEqual(getEditedPalette(visiblePalette, [{ type: 'rotate', direction: 'right' }]), visiblePalette)
assert.equal(getEditedPalette(visiblePalette, [{ type: 'snapshot', data: alphaImage }]), null, 'Restoring the original clears the palette')
assert.deepEqual(getEditedPalette(null, [{ type: 'snapshot', data: alphaImage, palette: visiblePalette }]), visiblePalette)
assert.equal(getEditedPalette(visiblePalette, [{ type: 'stroke', stroke: { color: '#FF0000', width: 1, points: [] } }]), null, 'New drawing can introduce colors deliberately')

const priorDocument = globalThis.document
const context = { imageSmoothingEnabled: true, drawImage: () => {}, getImageData: () => alphaImage }
globalThis.document = { createElement: () => ({ getContext: () => context }) } as unknown as Document
try {
  getImageDataFromImage({ width: 2400, height: 1600 } as HTMLCanvasElement, 1200)
  assert.equal(context.imageSmoothingEnabled, false, 'Large-image sampling disables interpolation that invents extra colors')
} finally { globalThis.document = priorDocument }

const many = pixels(...Array.from({ length: 1024 }, (_, i) => [i % 256, Math.floor(i / 256) * 64, i % 127, 255]))
for (const value of [1, 16, 64, 128, 256]) {
  const result = reduceImageColors(many.slice(), { mode: 'count', value })
  assert.equal(result.before, 1024)
  assert.ok(result.after <= value)
  assert.equal(result.data.length, many.length)
  assert.deepEqual(result, reduceImageColors(many.slice(), { mode: 'count', value }), 'Reduction is deterministic')
}
assert.throws(() => reduceImageColors(whites.slice(), { mode: 'count', value: 0 }))
assert.throws(() => reduceImageColors(whites.slice(), { mode: 'count', value: 1.5 }))
assert.throws(() => reduceImageColors(whites.slice(), { mode: 'threshold', value: NaN }))
assert.throws(() => reduceImageColors(whites.slice(), { mode: 'threshold', value: -1 }))
assert.deepEqual(getEditedImageSize({ width: 100, height: 60 }, [
  { type: 'crop', rectangle: { x: 0, y: 0, width: 20, height: 30 } },
  { type: 'snapshot', data: { width: 100, height: 60 } as ImageData },
  { type: 'rotate', direction: 'right' },
]), { width: 60, height: 100 }, 'Restoring a snapshot restores dimensions before subsequent transforms')
console.log('perler color reduction: requested palette sizes, example whites, threshold boundaries, no chaining, alpha, deterministic output and snapshot dimensions passed')
