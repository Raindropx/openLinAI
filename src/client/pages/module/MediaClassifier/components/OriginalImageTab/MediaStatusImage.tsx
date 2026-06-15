import { FullscreenOutlined } from '@ant-design/icons'
import { Image } from 'antd'
import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { MediaImageItem } from '../../types'

interface MediaStatusImageProps {
  item: MediaImageItem
  preview?: boolean
  rootClassName?: string
  imageClassName?: string
  onClick?: () => void
  selectionMode?: boolean
  selected?: boolean
  onSelect?: () => void
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
  selectionMode = false,
  selected = false,
  onSelect,
}: MediaStatusImageProps) {
  const [previewVisible, setPreviewVisible] = useState(false)
  const status =
    item.status === 'keep' || item.status === 'delete'
      ? statusConfig[item.status]
      : null
  const isInteractive = selectionMode ? Boolean(onSelect) : Boolean(onClick)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isInteractive) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (selectionMode) {
        onSelect?.()
        return
      }

      onClick?.()
    }
  }

  const handleContainerClick = () => {
    if (selectionMode) {
      onSelect?.()
      return
    }

    onClick?.()
  }

  const handlePreviewClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setPreviewVisible(true)
  }

  return (
    <div
      className={`group relative overflow-hidden rounded-xl bg-slate-100 ${isInteractive ? 'cursor-pointer transition hover:opacity-100' : ''} ${selected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white' : ''} ${rootClassName}`.trim()}
      onClick={handleContainerClick}
      onKeyDown={handleKeyDown}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
    >
      <Image
        src={item.previewUrl}
        alt={item.name}
        preview={selectionMode ? false : preview}
        classNames={{
          root: 'h-full w-full',
          image: `h-full! w-full! ${imageClassName}`.trim(),
        }}
      />

      {selected ? (
        <div
          className="pointer-events-none absolute inset-0 bg-sky-400/30"
          aria-hidden="true"
        />
      ) : null}

      {selectionMode ? (
        <>
          <button
            type="button"
            className="absolute top-2 right-2 z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded border border-white/40 bg-gray-700/20 text-white opacity-0 shadow-sm backdrop-blur-sm transition group-hover:opacity-100"
            onClick={handlePreviewClick}
            aria-label={`预览图片 ${item.name}`}
          >
            <FullscreenOutlined />
          </button>
          <div className="hidden">
            <Image
              src={item.previewUrl}
              alt={item.name}
              preview={{
                visible: previewVisible,
                onVisibleChange: setPreviewVisible,
              }}
            />
          </div>
        </>
      ) : null}

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
