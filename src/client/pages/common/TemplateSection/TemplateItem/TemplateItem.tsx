import { PictureOutlined } from '@ant-design/icons'
import { Card, Checkbox, Image, Tooltip, message } from 'antd'
import copy from 'copy-to-clipboard'
import dayjs from 'dayjs'
import { useState, type DragEvent } from 'react'
import { TaskTemplate } from '../../../../../server/common/template-manager'
import { ImageGroup } from '../../../../pages/common/components/ImageGroup'
import { TemplateItemHeader } from './TemplateItemHeader'

interface TemplateItemProps {
  template: TaskTemplate
  draggable?: boolean
  onLoad: (template: TaskTemplate) => void
  onReorder: (
    draggedId: string,
    targetId: string,
    position: TemplateDropPosition,
  ) => void
  variant?: 'list' | 'tile'
  selectionMode?: boolean
  selected?: boolean
  onToggleSelect?: (templateId: string) => void
  active?: boolean
  clickToLoad?: boolean
}

export type TemplateDropPosition = 'before' | 'after'

export function TemplateItem({
  template,
  draggable = false,
  onLoad,
  onReorder,
  variant = 'list',
  selectionMode = false,
  selected = false,
  onToggleSelect,
  active = false,
  clickToLoad = false,
}: TemplateItemProps) {
  const [dropPosition, setDropPosition] = useState<TemplateDropPosition | null>(
    null,
  )

  const getDropPosition = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  const tileMode = variant === 'tile'

  return (
    <Card
      size="small"
      onClick={() => {
        if (selectionMode) {
          onToggleSelect?.(template.id)
        } else if (clickToLoad) {
          onLoad(template)
        }
      }}
      className={`template-card shadow-sm ${
        selectionMode || clickToLoad ? 'cursor-pointer' : ''
      } ${
        selected || active
          ? 'template-card-active'
          : ''
      } ${
        dropPosition === 'before'
          ? 'border-t-2! border-t-blue-500!'
          : dropPosition === 'after'
            ? 'border-b-2! border-b-blue-500!'
            : ''
      }`}
      classNames={{
        body: tileMode
          ? 'template-card-body p-0! overflow-hidden transition-colors duration-100'
          : 'template-card-body p-[10px]! transition-colors duration-100',
      }}
      onDragOver={(event) => {
        if (!draggable) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropPosition(getDropPosition(event))
      }}
      onDragLeave={(event) => {
        if (
          !event.relatedTarget ||
          !event.currentTarget.contains(event.relatedTarget as Node)
        ) {
          setDropPosition(null)
        }
      }}
      onDrop={(event) => {
        if (!draggable) return
        event.preventDefault()
        event.stopPropagation()
        const position = getDropPosition(event)
        setDropPosition(null)
        try {
          const data = JSON.parse(
            event.dataTransfer.getData('application/json'),
          )
          if (data.type === 'template' && data.id) {
            onReorder(data.id, template.id, position)
          }
        } catch {
          // 忽略其他类型的拖放数据
        }
      }}
    >
      {tileMode ? (
        <div className="flex h-full flex-row sm:flex-col">
          <div className="template-card-media relative h-[112px] w-[92px] shrink-0 overflow-hidden border-r sm:h-auto sm:w-auto sm:aspect-[4/3] sm:border-r-0 sm:border-b">
            {template.images?.[0] ? (
              <Image
                src={template.images[0]}
                alt={template.title || '模板预览'}
                preview={!selectionMode}
                classNames={{
                  root: 'w-full h-full',
                  image: 'w-full! h-full! object-cover',
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-600">
                <PictureOutlined className="text-3xl" />
                <span className="text-xs">暂无参考图</span>
              </div>
            )}
            {template.images && template.images.length > 1 && (
              <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {template.images.length} 张
              </span>
            )}
            {selectionMode && (
              <div
                className="absolute top-2 left-2 rounded-md bg-black/55 p-1"
                onClick={(event) => event.stopPropagation()}
              >
                <Checkbox
                  checked={selected}
                  onChange={() => onToggleSelect?.(template.id)}
                />
              </div>
            )}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 p-2 sm:gap-2 sm:p-3">
            {!selectionMode && (
              <TemplateItemHeader
                template={template}
                draggable={draggable}
                onLoad={onLoad}
                clickToLoad={clickToLoad}
              />
            )}
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="min-w-0 flex-1 truncate font-bold text-slate-100"
                title={template.title}
              >
                {template.title || '未命名模板'}
              </div>
              <div className="shrink-0 text-[11px] text-slate-500">
                {dayjs(template.createdAt).format('YY/MM/DD')}
              </div>
            </div>
            <Tooltip title={template.prompt} placement="bottom">
              <p
                className="m-0 line-clamp-2 cursor-pointer text-xs leading-5 text-slate-400 transition-colors hover:text-amber-300 sm:line-clamp-3"
                onClick={(event) => {
                  event.stopPropagation()
                  if (!selectionMode && template.prompt) {
                    copy(template.prompt)
                    message.success('提示词已复制')
                  }
                }}
              >
                {template.prompt || '暂无提示词'}
              </p>
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {selectionMode && (
            <Checkbox
              checked={selected}
              onChange={() => onToggleSelect?.(template.id)}
              onClick={(event) => event.stopPropagation()}
            />
          )}
          <ImageGroup images={template.images || []} width={80} height={100} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {!selectionMode && (
              <TemplateItemHeader
                template={template}
                draggable={draggable}
                onLoad={onLoad}
                clickToLoad={clickToLoad}
              />
            )}
            <div className="flex items-center gap-2">
              {template.title && (
                <div
                  className="truncate font-bold text-slate-100"
                  title={template.title}
                >
                  {template.title}
                </div>
              )}
              <div className="shrink-0 text-xs text-slate-500">
                {dayjs(template.createdAt).format('YY/MM/DD HH:mm')}
              </div>
            </div>
            <Tooltip title={template.prompt} placement="bottom">
              <p
                className="m-0 line-clamp-2 cursor-pointer text-sm text-slate-400 transition-colors hover:text-amber-300"
                onClick={() => {
                  if (template.prompt) {
                    copy(template.prompt)
                    message.success('提示词已复制')
                  }
                }}
              >
                {template.prompt}
              </p>
            </Tooltip>
          </div>
        </div>
      )}
    </Card>
  )
}
