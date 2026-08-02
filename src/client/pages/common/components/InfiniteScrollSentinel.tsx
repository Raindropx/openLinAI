import { Spin } from 'antd'
import { useEffect, useRef } from 'react'

interface InfiniteScrollSentinelProps {
  hasMore: boolean
  onLoadMore: () => void
}

export function InfiniteScrollSentinel({
  hasMore,
  onLoadMore,
}: InfiniteScrollSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore()
      },
      { rootMargin: '160px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore])

  if (!hasMore) return null

  return (
    <div
      ref={sentinelRef}
      className="flex h-12 items-center justify-center gap-2 text-xs text-slate-500"
    >
      <Spin size="small" />
      继续滚动加载
    </div>
  )
}
