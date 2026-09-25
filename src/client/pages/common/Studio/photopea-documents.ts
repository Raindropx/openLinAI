export interface PhotopeaDocumentIdentity {
  name: string
  source: string
  width: string
  height: string
}

export interface PhotopeaDocumentSnapshot {
  active: PhotopeaDocumentIdentity
  documents: PhotopeaDocumentIdentity[]
}

export function findActivePhotopeaDocumentIndex(snapshot: PhotopeaDocumentSnapshot) {
  const { active, documents } = snapshot
  if (documents.length === 1) return 0
  if (active.source) {
    const bySource = documents.flatMap((document, index) =>
      document.source === active.source ? [index] : [],
    )
    if (bySource.length === 1) return bySource[0]
  }
  const byAppearance = documents.flatMap((document, index) =>
    document.name === active.name &&
    document.width === active.width &&
    document.height === active.height
      ? [index]
      : [],
  )
  return byAppearance.length === 1 ? byAppearance[0] : -1
}
