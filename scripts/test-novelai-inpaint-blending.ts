import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { compositeFocusedInpaint, manualFocusedInpaintLayer, prepareFocusedInpaint, type FocusedInpaint } from '../src/server/module/gpt-image/novelai-focused-inpaint'
import { blurNovelAIInpaintInput } from '../src/server/module/gpt-image/novelai-inpaint-input'

const size = 160
const scale = 1024 / size

function fixture(rectangles: number[][], bias = [0, 0, 0], transparentContext = false, generatedRectangles = rectangles) {
  const original = new PNG({ width: size, height: size })
  const mask = new PNG({ width: size, height: size })
  const generated = new PNG({ width: 1024, height: 1024 })
  const selected = (x: number, y: number) => rectangles.some(([l, t, r, b]) => x >= l && x < r && y >= t && y < b)
  // A changed interior feature, independent of context colour drift.
  const detail = (x: number, y: number) => generatedRectangles.some(([l, t, r, b]) => x >= l && x < r && y >= t && y < b) ? 30 : 0
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

async function run(input: ReturnType<typeof fixture>, feather: number, preserveTransparency = false, mode: 'strict' | 'soft' = 'strict', edgeFeather?: number) {
  const focus: FocusedInpaint = { left: 0, top: 0, width: size, height: size, targetWidth: 1024, targetHeight: 1024, image: '', mask: '' }
  return PNG.sync.read(await compositeFocusedInpaint(input.original, input.generated, input.mask, size, size, focus, preserveTransparency, feather, mode, edgeFeather))
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

  const softInput = (radius: number) => fixture([[71, 48, 89, 112]], [0, 0, 0], false,
    [[71 - radius, 48 - radius, 89 + radius, 112 + radius]])
  const soft20 = await run(softInput(20), 20, false, 'soft')
  const soft32 = await run(softInput(32), 32, false, 'soft')
  assert.ok(pixel(soft32, 80, 80)[0] < pixel(soft20, 80, 80)[0], 'small masks must honor 20 vs 32 instead of silently capping both')
  assert.ok(pixel(soft32, 65, 80)[0] > 70, 'soft blending must cross the painted boundary')
  assert.deepEqual(pixel(soft32, 38, 80), [70, 90, 110, 255], 'pixels beyond the requested halo must remain identical')
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < 39 || x >= 121 || y < 16 || y >= 144)
        assert.deepEqual(pixel(soft32, x, y), [70, 90, 110, 255], 'soft mode cannot modify pixels outside its finite support')
    }
  }
  const softFull = await run(fixture([[0, 0, size, size]]), 32, false, 'soft')
  assert.deepEqual(pixel(softFull, 0, 0), [100, 90, 110, 255], 'Gaussian padding must not fade a fully selected canvas corner')
  assert.deepEqual((await run(fixture([]), 32, false, 'soft')).data, PNG.sync.read(fixture([]).original).data)

  const controlledInput = softInput(20)
  const controlled4 = await run(controlledInput, 20, false, 'soft', 4)
  const controlled12 = await run(controlledInput, 20, false, 'soft', 12)
  assert.deepEqual(pixel(controlled4, 80, 80), [100, 90, 110, 255], 'the selected core must stay fully generated')
  assert.deepEqual(pixel(controlled12, 80, 80), [100, 90, 110, 255], 'a wider feather must not wash out the selected core')
  assert.ok(pixel(controlled12, 54, 80)[0] < pixel(controlled4, 54, 80)[0], 'edge feather width must change only the outer band')
  assert.deepEqual(pixel(controlled12, 50, 80), [70, 90, 110, 255], 'controlled blending must not exceed the transition radius')
  const hardEdge = await run(controlledInput, 20, false, 'soft', 0)
  assert.equal(pixel(hardEdge, 50, 80)[0], 70, 'the halo must stop at its requested radius')
  assert.equal(pixel(hardEdge, 51, 80)[0], 100, 'zero feather must keep a hard edge inside the halo')

  const focus: FocusedInpaint = { left: 0, top: 0, width: size, height: size, targetWidth: 1024, targetHeight: 1024, image: '', mask: '' }
  const manual = PNG.sync.read(await manualFocusedInpaintLayer(controlledInput.generated, controlledInput.mask, size, size, focus, 20, 'soft', 8))
  assert.equal(pixel(manual, 80, 80)[3], 255, 'the manual layer must retain an opaque generated core')
  assert.ok(pixel(manual, 53, 80)[3] > 0 && pixel(manual, 53, 80)[3] < 255, 'the manual layer must include an editable feather')
  assert.equal(pixel(manual, 50, 80)[3], 0, 'the manual layer must leave the original outside its halo visible')

  const croppedInput = fixture([[60, 60, 70, 70]])
  const croppedFocus: FocusedInpaint = { left: 40, top: 40, width: 64, height: 64, targetWidth: 1024, targetHeight: 1024, image: '', mask: '' }
  const croppedGenerated = new PNG({ width: 1024, height: 1024 })
  for (let i = 0; i < croppedGenerated.data.length; i += 4)
    croppedGenerated.data.set([180, 40, 60, 255], i)
  const croppedLayer = PNG.sync.read(await manualFocusedInpaintLayer(
    PNG.sync.write(croppedGenerated), croppedInput.mask, size, size, croppedFocus, 8, 'strict',
  ))
  assert.deepEqual(pixel(croppedLayer, 65, 65), [180, 40, 60, 255], 'a focused result must align with its source-image crop')
  assert.equal(pixel(croppedLayer, 20, 20)[3], 0, 'the generated crop must not cover unrelated image areas')

  const alphaInput = softInput(32)
  const alphaGenerated = PNG.sync.read(alphaInput.generated)
  for (let i = 3; i < alphaGenerated.data.length; i += 4) alphaGenerated.data[i] = 128
  alphaInput.generated = PNG.sync.write(alphaGenerated)
  const alphaOutput = await run(alphaInput, 32, true, 'soft')
  assert.ok(pixel(alphaOutput, 80, 80)[3] > 128 && pixel(alphaOutput, 80, 80)[3] < 255)
  assert.deepEqual(pixel(alphaOutput, 0, 0), [70, 90, 110, 255], 'explicit alpha must stay confined to the halo')

  // Large or edge-touching masks must still use soft blending on a rectangular canvas.
  const rectSource = new PNG({ width: 256, height: 128 })
  const rectMask = new PNG({ width: 256, height: 128 })
  for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4
    rectSource.data.set([70, 90, 110, 255], i)
    const value = x < 40 && y < 60 ? 255 : 0
    rectMask.data.set([value, value, value, 255], i)
  }
  const rectOriginal = PNG.sync.write(rectSource)
  const rectMaskBuffer = PNG.sync.write(rectMask)
  const whole = await prepareFocusedInpaint(rectOriginal, rectMaskBuffer, 256, 128, 192, 'soft', 32)
  assert.ok(whole)
  assert.deepEqual([whole.left, whole.top, whole.width, whole.height, whole.targetWidth, whole.targetHeight], [0, 0, 256, 128, 256, 128])
  const submittedMask = PNG.sync.read(Buffer.from(whole.mask, 'base64'))
  assert.equal(submittedMask.data[(30 * 256 + 55) * 4], 255, 'the provider must generate pixels in the blend halo')
  assert.equal(submittedMask.data[(30 * 256 + 72) * 4], 0, 'generation mask must not exceed blend support')
  const rectGenerated = PNG.sync.read(rectOriginal)
  for (let i = 0; i < rectGenerated.data.length; i += 4) if (submittedMask.data[i]) rectGenerated.data[i] = 100
  const rectOutput = PNG.sync.read(await compositeFocusedInpaint(rectOriginal, PNG.sync.write(rectGenerated), rectMaskBuffer, 256, 128, whole, false, 32, 'soft'))
  assert.equal(rectOutput.data[0], 100)
  assert.ok(rectOutput.data[(30 * 256 + 45) * 4] > 70)
  assert.equal(rectOutput.data[(30 * 256 + 73) * 4], 70)

  const blurSource = new PNG({ width: 64, height: 64 })
  const blurMask = new PNG({ width: 64, height: 64 })
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4
    const color = (x + y) % 2 ? 255 : 0
    blurSource.data.set([color, color, color, 255], offset)
    const selected = x >= 16 && x < 48 && y >= 16 && y < 48 ? 255 : 0
    blurMask.data.set([selected, selected, selected, 255], offset)
  }
  const blurred = PNG.sync.read(await blurNovelAIInpaintInput(PNG.sync.write(blurSource), PNG.sync.write(blurMask), 64, 64))
  assert.ok(blurred.data[(32 * 64 + 32) * 4] > 110 && blurred.data[(32 * 64 + 32) * 4] < 145,
    'blurred input must remove high-frequency detail inside the mask')
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (x >= 16 && x < 48 && y >= 16 && y < 48) continue
    const offset = (y * 64 + x) * 4
    assert.deepEqual(blurred.data.subarray(offset, offset + 4), blurSource.data.subarray(offset, offset + 4),
      'input blur must leave every unselected pixel unchanged')
  }
  console.log('NovelAI blending: strict compatibility, soft halo/support, real 20/32 differences, rectangular fallback and alpha passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
