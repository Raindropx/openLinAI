import { Image } from 'antd'
import type { KeyboardEvent } from 'react'
import type { MediaImageItem } from '../../types'

interface MediaStatusImageProps {
  item: MediaImageItem
  preview?: boolean
  rootClassName?: string
  imageClassName?: string
  onClick?: () => void
  ariaLabel?: string
}

const statusConfig = {
  keep: {
    label: '已保留',
    overlayClassName:
      'bg-gradient-to-t from-blue-950/70 via-blue-700/20 to-slate-950/5 shadow-[inset_0_-140px_120px_rgba(30,64,175,0.42)]',
    badgeClassName:
      'border-blue-100/70 bg-blue-500/92 text-white shadow-[0_18px_50px_rgba(30,64,175,0.35)]',
  },
  delete: {
    label: '预删除',
    overlayClassName:
      'bg-gradient-to-t from-red-950/75 via-red-700/25 to-slate-950/5 shadow-[inset_0_-140px_120px_rgba(153,27,27,0.45)]',
    badgeClassName:
      'border-red-100/70 bg-red-500/92 text-white shadow-[0_18px_50px_rgba(153,27,27,0.38)]',
  },
} as const

export function MediaStatusImage({
  item,
  preview = true,
  rootClassName = '',
  imageClassName = '',
  onClick,
  ariaLabel,
}: MediaStatusImageProps) {
  const status =
    item.status === 'keep' || item.status === 'delete'
      ? statusConfig[item.status]
      : null

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-slate-100 ${onClick ? 'cursor-pointer transition hover:opacity-100' : ''} ${rootClassName}`.trim()}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
    >
      <Image
        src={item.previewUrl}
        alt={item.name}
        preview={preview}
        classNames={{
          root: 'h-full w-full',
          image: `h-full! w-full! ${imageClassName}`.trim(),
        }}
      />

      {status ? (
        <div className="pointer-events-none absolute inset-0">
          <div
            className={`absolute inset-0 ${status.overlayClassName}`.trim()}
            aria-hidden="true"
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className={`rounded border px-1 text-base backdrop-blur-[2px] ${status.badgeClassName}`.trim()}
            >
              {status.label}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
