import assert from 'node:assert/strict'
import {
  findActivePhotopeaDocumentIndex,
  type PhotopeaDocumentIdentity,
} from '../src/client/pages/common/Studio/photopea-documents'

const document = (
  name: string,
  source = '',
  width = '1024 px',
  height = '1024 px',
): PhotopeaDocumentIdentity => ({ name, source, width, height })

assert.equal(
  findActivePhotopeaDocumentIndex({
    active: document('Untitled'),
    documents: [document('Untitled')],
  }),
  0,
  'A single open document does not require object identity',
)

assert.equal(
  findActivePhotopeaDocumentIndex({
    active: document('Same name', 'linai:second'),
    documents: [
      document('Same name', 'linai:first'),
      document('Same name', 'linai:second'),
    ],
  }),
  1,
  'Managed documents are matched by source',
)

assert.equal(
  findActivePhotopeaDocumentIndex({
    active: document('Artwork', '', '800 px', '600 px'),
    documents: [document('Other'), document('Artwork', '', '800 px', '600 px')],
  }),
  1,
  'External documents are matched by visible identity',
)

assert.equal(
  findActivePhotopeaDocumentIndex({
    active: document('Duplicate'),
    documents: [document('Duplicate'), document('Duplicate')],
  }),
  -1,
  'Ambiguous documents must not receive the layer',
)

console.log('Photopea document selection passed')
