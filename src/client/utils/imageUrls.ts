/** Only local image routes support thumbnails and lightweight metadata. */
export function localImageVariant(
  src: string,
  variant: 'thumb' | 'metadata',
): string | undefined {
  if (!/^\/api\/static\/images\/(generated|input)\/[^/?#]+(?:[?#]|$)/.test(src))
    return undefined
  const url = new URL(src, 'http://localhost')
  url.searchParams.delete('thumb')
  url.searchParams.delete('metadata')
  url.searchParams.set(variant, 'true')
  return `${url.pathname}${url.search}${url.hash}`
}

export const imageThumbnailUrl = (src: string, version = '') => {
  const thumbnail = localImageVariant(src, 'thumb')
  if (!thumbnail) return src
  if (!version) return thumbnail
  const url = new URL(thumbnail, 'http://localhost')
  url.searchParams.set('cacheVersion', version)
  return `${url.pathname}${url.search}${url.hash}`
}
