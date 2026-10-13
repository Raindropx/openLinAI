import dayjs from 'dayjs'
import { v4 as uuid } from 'uuid'

/** Keep the translated export label and extension, adding local time and a random suffix. */
export function createPerlerExportFilename(filename: string) {
  const extensionIndex = filename.lastIndexOf('.')
  const stem = extensionIndex < 0 ? filename : filename.slice(0, extensionIndex)
  const extension = extensionIndex < 0 ? '' : filename.slice(extensionIndex)
  const suffix = `${dayjs().format('YYYYMMDD_HHmmss_SSS')}_${uuid().slice(0, 8)}`
  return `${stem}_${suffix}${extension}`
}
