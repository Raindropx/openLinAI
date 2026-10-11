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
  state().commitEditedImage('blob:first', image, data)
  state().commitEditedImage('blob:second', image, data)
  assert.equal(state().sourceHistoryIndex, 2)
  state().restoreSourceImage(1, image, data)
  assert.equal(state().imageUrl, 'blob:first')
  state().restoreSourceImage(2, image, data)
  assert.equal(state().imageUrl, 'blob:second')
  state().restoreSourceImage(1, image, data)
  state().commitEditedImage('blob:branch', image, data)
  assert.deepEqual(state().sourceHistory, ['blob:original', 'blob:first', 'blob:branch'])
  assert.ok(released.includes('blob:second'), 'Replacing the redo branch releases its Blob')
  assert.ok(!released.includes('blob:original'), 'Undo retains the original')
  assert.deepEqual(state().gridSize, { columns: 20, rows: 15 })
  assert.deepEqual(state().cellOverrides['0,0'], { color: '#FF0000' })
  for (let index = 0; index < 12; index++) state().commitEditedImage(`blob:edit-${index}`, image, data)
  assert.equal(state().sourceHistory.length, 10, 'History stays bounded')
  assert.equal(state().sourceHistoryIndex, 9)
  const oldHistory = [...state().sourceHistory]
  state().setImage('blob:replacement', image, data)
  assert.deepEqual(state().sourceHistory, ['blob:replacement'])
  assert.deepEqual(state().cellOverrides, {})
  assert.ok(oldHistory.every((url) => released.includes(url)), 'Changing source releases all old history')
  state().reset()
  assert.ok(released.includes('blob:replacement'))
  console.log('perler source history: undo/redo, branch replacement, preserved grid edits, bounded history and Blob cleanup passed')
} finally { URL.revokeObjectURL = originalRevoke }
