import { Image } from 'antd'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { useThumbnailCacheVersion } from '../../../hooks/useThumbnailCacheVersion'
import { imageThumbnailUrl } from '../../../utils/imageUrls'

const PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** Ant Image probes src with new Image(), so loading="lazy" alone is insufficient. */
export function ThumbnailImage({
  src,
  onLoad,
  ...props
}: ComponentProps<typeof Image>) {
  const root = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const version = useThumbnailCacheVersion()
  useEffect(() => {
    const target = root.current?.querySelector('img')
    if (!target) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])
  return (
    <span ref={root} className="contents">
      <Image
        {...props}
        src={visible && src ? imageThumbnailUrl(src, version) : PLACEHOLDER}
        loading="lazy"
        decoding="async"
        onLoad={(event) => {
          if (visible) onLoad?.(event)
        }}
      />
    </span>
  )
}
