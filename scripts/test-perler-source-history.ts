import assert from 'node:assert/strict'
import { usePerlerBeadStore } from '../src/client/pages/module/PerlerBead/store'

const state = () => usePerlerBeadStore.getState()
const image = { naturalWidth: 128, naturalHeight: 96 } as HTMLImageElement
const data = { width: 128, height: 96 } as ImageData
const originalRevoke = URL.revokeObjectURL
const released: string[] = []
URL.revokeObjectURL = (url) => { released.push(url) }
try {
  state().setImage('blob:original', image, data)
  state().setGridSize({ columns: 20, rows: 15 })
  state().setCellOverride(0, 0, { color: '#FF0000' })
  const palette = ['#000000', '#FFFFFF']
  state().commitEditedImage('blob:first', image, data, palette)
  assert.deepEqual(state().sourcePalette, palette)
  state().commitEditedImage('blob:second', image, data)
  assert.equal(state().sourcePalette, null)
  assert.equal(state().sourceHistoryIndex, 2)
  state().restoreSourceImage(1, image, data)
  assert.equal(state().imageUrl, 'blob:first')
  assert.deepEqual(state().sourcePalette, palette, 'Undo restores the reduced palette together with the image')
  state().restoreSourceImage(2, image, data)
  assert.equal(state().imageUrl, 'blob:second')
  assert.equal(state().sourcePalette, null, 'Redo restores the unrestricted version')
  state().restoreSourceImage(1, image, data)
  state().commitEditedImage('blob:branch', image, data)
  assert.equal(state().sourcePalette, null, 'A new editing branch does not inherit a discarded palette')
  assert.deepEqual(state().sourceHistory, ['blob:original', 'blob:first', 'blob:branch'])
  assert.ok(released.includes('blob:second'), 'Replacing the redo branch releases its Blob')
  assert.ok(!released.includes('blob:original'), 'Undo retains the original')
  assert.deepEqual(state().gridSize, { columns: 20, rows: 15 })
  assert.deepEqual(state().cellOverrides['0,0'], { color: '#FF0000' })
  for (let index = 0; index < 12; index++) state().commitEditedImage(`blob:edit-${index}`, image, data)
  assert.equal(state().sourceHistory.length, 10, 'History stays bounded')
  assert.equal(state().sourceHistoryIndex, 9)
  assert.equal(state().originalSource?.url, 'blob:original', 'The loaded original survives history trimming')
  assert.ok(!released.includes('blob:original'), 'Trimming history must not release the loaded original')
  state().commitEditedImage(state().originalSource!.url, image, data)
  assert.equal(state().imageUrl, 'blob:original', 'Restore commits the loaded original as an undoable edit')
  state().restoreSourceImage(state().sourceHistoryIndex - 1, image, data)
  assert.equal(state().imageUrl, 'blob:edit-11', 'Restore can be undone')
  const oldHistory = [...state().sourceHistory]
  state().setImage('blob:replacement', image, data)
  assert.deepEqual(state().sourceHistory, ['blob:replacement'])
  assert.deepEqual(state().cellOverrides, {})
  assert.ok(oldHistory.every((url) => released.includes(url)), 'Changing source releases all old history')
  assert.ok(released.includes('blob:original'), 'Changing source releases the pinned original')
  state().reset()
  assert.ok(released.includes('blob:replacement'))
  assert.equal(state().originalSource, null)
  assert.equal(state().sourcePalette, null)
  console.log('perler source history: undo/redo, branch replacement, preserved grid edits, bounded history and Blob cleanup passed')
} finally { URL.revokeObjectURL = originalRevoke }
