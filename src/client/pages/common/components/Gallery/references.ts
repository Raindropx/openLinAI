import { mapBackupImageUrls } from '../../../../../shared/task-backup'

export const normalizeComparableUrl = (url: string) =>
  url
    .replace(/^https?:\/\/[^/]+/i, '')
    .split('?')[0]
    .split('#')[0]
    .trim()

export function collectGalleryImageReferences(value: unknown): Set<string> {
  const urls = new Set<string>()
  mapBackupImageUrls(value, (url) => {
    urls.add(normalizeComparableUrl(url))
    return url
  })
  return urls
}

export function resolveGalleryReference(
  url: string,
  templateUrls: ReadonlySet<string>,
  taskUrls: ReadonlySet<string>,
): 'template' | 'task' | 'none' {
  const comparableUrl = normalizeComparableUrl(url)
  if (templateUrls.has(comparableUrl)) return 'template'
  if (taskUrls.has(comparableUrl)) return 'task'
  return 'none'
}
