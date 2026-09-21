import {
  CheckSquareOutlined,
  DeleteOutlined,
  FileAddOutlined,
} from '@ant-design/icons'
import { Button, Image, Tooltip } from 'antd'
import { useEffect, useRef, type ReactNode } from 'react'

export interface ReviewImage {
  taskId: string
  imageIndex: number
  src: string
}

// Reuse the preview's navigation action so touch, keyboard and buttons all
// reset zoom/rotation in the same way.
function ReviewSwipeActions({
  children,
  open,
  current,
  scale,
  onActive,
}: {
  children: ReactNode
  open: boolean
  current: number
  scale: number
  onActive: (offset: number) => void
}) {
  const gesture = useRef<{ x: number; y: number; id: number } | null>(null)

  useEffect(() => {
    gesture.current = null
  }, [open, current])

  useEffect(() => {
    if (!open) return

    const cancel = () => {
      gesture.current = null
    }
    const start = (event: TouchEvent) => {
      cancel()
      if (
        scale > 1 ||
        event.touches.length !== 1 ||
        !window.matchMedia('(max-width: 767px)').matches ||
        !(event.target instanceof Element) ||
        !event.target.closest('.task-review-preview .ant-image-preview-img')
      )
        return

      const touch = event.touches[0]
      gesture.current = {
        x: touch.clientX,
        y: touch.clientY,
        id: touch.identifier,
      }
    }
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 1 || scale > 1) {
        cancel()
        return
      }
      if (!gesture.current) return
      // Keep an unzoomed image still while deciding whether this is a swipe.
      // Multi-touch and zoomed dragging continue through the native preview.
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
    }
    const end = (event: TouchEvent) => {
      const origin = gesture.current
      cancel()
      if (!origin || event.touches.length || scale > 1) return
      const touch = Array.from(event.changedTouches).find(
        (item) => item.identifier === origin.id,
      )
      if (!touch) return
      const dx = touch.clientX - origin.x
      const dy = touch.clientY - origin.y
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        onActive(dx < 0 ? 1 : -1)
      }
    }

    window.addEventListener('touchstart', start, true)
    window.addEventListener('touchmove', move, {
      capture: true,
      passive: false,
    })
    window.addEventListener('touchend', end, true)
    window.addEventListener('touchcancel', cancel, true)
    return () => {
      window.removeEventListener('touchstart', start, true)
      window.removeEventListener('touchmove', move, true)
      window.removeEventListener('touchend', end, true)
      window.removeEventListener('touchcancel', cancel, true)
    }
  }, [open, scale, onActive])

  return children
}

export function TaskReviewPreview({
  images,
  current,
  onChange,
  onClose,
  onAfterClose,
  selectionMode,
  selected,
  canDelete,
  canAddToTemplate,
  canSelect,
  deleting,
  onDelete,
  onAddToTemplate,
  onToggleSelection,
}: {
  images: ReviewImage[]
  current: number
  onChange: (index: number) => void
  onClose: () => void
  onAfterClose: () => void
  selectionMode: boolean
  selected: boolean
  canDelete: boolean
  canAddToTemplate: boolean
  canSelect: boolean
  deleting: boolean
  onDelete: () => void
  onAddToTemplate: () => void
  onToggleSelection: () => void
}) {
  const open = current >= 0
  const lastIndexRef = useRef(0)

  useEffect(() => {
    if (open) lastIndexRef.current = current
  }, [open, current])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const hasOpenModal = Array.from(
        document.querySelectorAll<HTMLElement>('.ant-modal-wrap'),
      ).some(
        (element) =>
          element.getClientRects().length > 0 &&
          window.getComputedStyle(element).display !== 'none',
      )
      if (
        event.key !== 'Enter' ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !canSelect ||
        hasOpenModal
      )
        return

      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      )
        return

      event.preventDefault()
      event.stopPropagation()
      onToggleSelection()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [canSelect, open, onToggleSelection])

  return (
    <Image.PreviewGroup
      items={images.map((image) => image.src)}
      classNames={{ popup: { root: 'task-review-preview' } }}
      preview={{
        open,
        // Keep the last image visible throughout the closing animation.
        current: open
          ? current
          : Math.min(lastIndexRef.current, Math.max(0, images.length - 1)),
        onChange,
        onOpenChange: (nextOpen) => {
          if (!nextOpen) onClose()
        },
        afterOpenChange: (nextOpen) => {
          if (!nextOpen) onAfterClose()
        },
        actionsRender: (node, { current: index, transform, actions }) => (
          <ReviewSwipeActions
            open={open}
            current={index}
            scale={transform.scale}
            onActive={actions.onActive}
          >
            <div className="task-review-preview-toolbar">
              {node}
              <div className="task-review-preview-toolbar-progress">
                {index + 1} / {images.length} · ← → 切图 · Enter 选中 ·
                窄屏可左右滑动
              </div>
              <div className="task-review-preview-task-actions">
                <Tooltip
                  title={
                    selectionMode
                      ? '多选模式下不可删除'
                      : canDelete
                        ? '删除'
                        : '当前任务已删除'
                  }
                >
                  <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    disabled={selectionMode || !canDelete}
                    loading={deleting}
                    onClick={onDelete}
                  >
                    删除
                  </Button>
                </Tooltip>
                <Tooltip
                  title={
                    selectionMode
                      ? '多选模式下不可添加模板'
                      : canAddToTemplate
                        ? '添加到模板'
                        : '当前任务没有可添加的模板信息'
                  }
                >
                  <Button
                    size="small"
                    icon={<FileAddOutlined />}
                    disabled={selectionMode || !canAddToTemplate || deleting}
                    onClick={onAddToTemplate}
                  >
                    添加到模板
                  </Button>
                </Tooltip>
                <Tooltip title="按 Enter 可执行相同行为">
                  <Button
                    type={selected ? 'primary' : 'default'}
                    size="small"
                    icon={<CheckSquareOutlined />}
                    disabled={!canSelect || deleting}
                    onClick={onToggleSelection}
                  >
                    {selected ? '取消选中' : '选中'}
                  </Button>
                </Tooltip>
              </div>
            </div>
          </ReviewSwipeActions>
        ),
      }}
    />
  )
}
