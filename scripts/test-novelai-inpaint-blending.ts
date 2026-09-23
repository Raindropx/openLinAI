import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { compositeFocusedInpaint, type FocusedInpaint } from '../src/server/module/gpt-image/novelai-focused-inpaint'

const size = 160
const scale = 1024 / size

function fixture(rectangles: number[][], bias = [0, 0, 0], transparentContext = false) {
  const original = new PNG({ width: size, height: size })
  const mask = new PNG({ width: size, height: size })
  const generated = new PNG({ width: 1024, height: 1024 })
  const selected = (x: number, y: number) => rectangles.some(([l, t, r, b]) => x >= l && x < r && y >= t && y < b)
  // A changed interior feature, independent of context colour drift.
  const detail = (x: number, y: number) => selected(x, y) ? 30 : 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      original.data.set([70, 90, 110, 255], i)
      const value = selected(x, y) ? 255 : 0
      mask.data.set([value, value, value, 255], i)
    }
  }
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const sx = Math.floor((x + 0.5) / scale)
      const sy = Math.floor((y + 0.5) / scale)
      generated.data.set([
        70 + bias[0] + detail(sx, sy),
        90 + bias[1],
        110 + bias[2],
        transparentContext && !selected(sx, sy) ? 0 : 255,
      ], (y * 1024 + x) * 4)
    }
  }
  return { original: PNG.sync.write(original), mask: PNG.sync.write(mask), generated: PNG.sync.write(generated), selection: selected }
}

async function run(input: ReturnType<typeof fixture>, feather: number, preserveTransparency = false) {
  const focus: FocusedInpaint = { left: 0, top: 0, size, image: '', mask: '' }
  return PNG.sync.read(await compositeFocusedInpaint(input.original, input.generated, input.mask, size, size, focus, preserveTransparency, feather))
}

const pixel = (image: PNG, x: number, y: number) => Array.from(image.data.subarray((y * size + x) * 4, (y * size + x) * 4 + 4))

async function main() {
  const rectangles = [[32, 32, 128, 128]]
  const baseline = await run(fixture(rectangles), 20)
  const biased = await run(fixture(rectangles, [24, -18, 12]), 20)
  assert.deepEqual(pixel(biased, 80, 80), [100, 90, 110, 255], 'colour correction must preserve the new interior feature')
  assert.deepEqual(biased.data, baseline.data, 'unchanged surrounding context must cancel a uniform colour cast')

  const small = fixture([[24, 32, 42, 90], [70, 20, 150, 150]])
  const wide = await run(small, 32)
  const medium = await run(small, 20)
  assert.deepEqual(pixel(wide, 33, 60), [100, 90, 110, 255], 'a narrow disconnected selection must still have a fully generated centre')
  assert.deepEqual(pixel(medium, 33, 60), pixel(wide, 33, 60))
  assert.ok(pixel(wide, 24, 60)[0] > 70 && pixel(wide, 24, 60)[0] < 100, 'the edge of a small selection must still blend')
  const original = PNG.sync.read(small.original)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!small.selection(x, y)) assert.deepEqual(pixel(wide, x, y), pixel(original, x, y), 'unselected pixels must remain byte-identical')
    }
  }

  const transparent = await run(fixture(rectangles, [24, -18, 12], true), 20)
  assert.deepEqual(pixel(transparent, 80, 80), [124, 72, 122, 255], 'transparent context must not contribute hidden RGB values')
  const preserve = await run(fixture(rectangles, [24, -18, 12]), 20, true)
  assert.deepEqual(pixel(preserve, 80, 80), [124, 72, 122, 255], 'explicit alpha generation must skip automatic colour correction')
  const empty = await run(fixture([]), 32)
  assert.deepEqual(empty.data, PNG.sync.read(fixture([]).original).data, 'empty selection is a no-op')
  const full = await run(fixture([[0, 0, size, size]], [24, -18, 12]), 32)
  assert.deepEqual(pixel(full, 80, 80), [124, 72, 122, 255], 'missing context must not invent a colour correction')
  const edge = await run(fixture([[0, 0, 18, 60]]), 32)
  assert.deepEqual(pixel(edge, 0, 20), [100, 90, 110, 255], 'canvas edges are not artificial unpainted borders')
  console.log('NovelAI blending: colour drift, narrow/disconnected masks, untouched pixels, alpha and canvas edges passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
