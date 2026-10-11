import { createResourceCache, resourceData } from '../service/resources'

const cache = createResourceCache('pending-images', [] as string[], () => resourceData<string[]>('/api/pending-images'))
export const usePendingImages = (enabled = true) => cache.useCache(enabled)
export async function changePendingImages(action: 'add' | 'remove', urls: string[]) {
  for (let offset = 0; offset < urls.length; offset += 100)
    await resourceData<string[]>('/api/pending-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, urls: urls.slice(offset, offset + 100) }) })
  await cache.refreshAsync()
}
