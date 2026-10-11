import fs from 'fs-extra'
import path from 'path'
import { getDataDir } from './data-dir'
import { withImageLifecycle } from './image-lifecycle'
import { SafeJsonStore } from './safe-json-store'

const file = path.join(getDataDir(), 'pending-images.json')
const store = new SafeJsonStore<string[]>(file)
const pattern = /^\/api\/static\/images\/input\/([a-z0-9_-]+\.(?:png|webp|jpe?g|gif|avif|tiff?|svg))$/i

export async function getPendingImages() {
  const value = await store.read()
  if (!value && await fs.pathExists(file)) throw new Error('待使用图库数据损坏，已保留备份')
  if (value && (!Array.isArray(value) || value.some((url) => typeof url !== 'string' || !pattern.test(url))))
    throw new Error('待使用图库数据格式无效')
  return value ?? []
}

/** Apply intents on the server; concurrent devices cannot overwrite one another's lists. */
export async function changePendingImages(action: 'add' | 'remove', urls: string[]) {
  return withImageLifecycle(async () => {
    await getPendingImages()
    const normalized: string[] = []
    if (action === 'add') {
      // Validate the whole batch before any image conversion or list mutation.
      for (const url of urls) {
        const match = /^\/api\/static\/images\/(input|generated)\/([a-z0-9_-]+\.(?:png|webp|jpe?g|gif|avif|tiff?|svg))$/i.exec(url)
        if (!match || !await fs.pathExists(path.join(getDataDir(), 'images', match[1], match[2])))
          throw new Error('图片不存在或地址无效')
      }
      for (const url of urls) {
        if (pattern.test(url)) normalized.push(url)
        else {
          const { uploadInputImage } = await import('./static')
          const { getImageMimeType } = await import('../module/gpt-image/image-files')
          const filename = url.slice(url.lastIndexOf('/') + 1)
          const source = path.join(getDataDir(), 'images', 'generated', filename)
          const buffer = await fs.readFile(source)
          const uploaded = await uploadInputImage(`data:${getImageMimeType(source)};base64,${buffer.toString('base64')}`, { maxDimension: 2048 })
          normalized.push(uploaded.url)
        }
      }
    } else normalized.push(...urls.filter((url) => pattern.test(url)))
    const target = new Set(normalized)
    return store.mutate((list) => action === 'add' ? [...new Set([...list, ...normalized])] : list.filter((url) => !target.has(url)))
  })
}
