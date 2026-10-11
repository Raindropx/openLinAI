import { useEffect } from 'react'
import { createResourceCache, resourceData, subscribeResource } from '../service/resources'

type ImageFile = { url: string; type: 'input' | 'generated'; createdAt: number }
type References = { templateUrls: string[]; taskUrls: string[]; protectedUrls: string[] }
const images = createResourceCache('images', [] as ImageFile[], () => resourceData<ImageFile[]>('/api/static/images/list'))
const references = createResourceCache('tasks', { templateUrls: [], taskUrls: [], protectedUrls: [] } as References, () => resourceData<References>('/api/static/images/references'))
export function useGalleryResources(enabled: boolean) {
  const files = images.useCache(enabled)
  const refs = references.useCache(enabled)
  useEffect(() => {
    if (!enabled) return
    const subscriptions = ['templates', 'pending-images', 'images'] as const
    const cleanup = subscriptions.map((resource) => subscribeResource(resource, references.refresh))
    return () => cleanup.forEach((unsubscribe) => unsubscribe())
  }, [enabled])
  return { files, refs }
}
