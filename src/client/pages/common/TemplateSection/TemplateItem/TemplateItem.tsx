import { Card, Tooltip, message } from 'antd'
import copy from 'copy-to-clipboard'
import dayjs from 'dayjs'
import { useState, type DragEvent } from 'react'
import { TaskTemplate } from '../../../../../server/common/template-manager'
import { ImageGroup } from '../../../../pages/common/components/ImageGroup'
import {
  TemplateItemGenerateButtons,
  TemplateItemHeader,
} from './TemplateItemHeader'

interface TemplateItemProps {
  template: TaskTemplate
  draggable?: boolean
  onLoad: (template: TaskTemplate) => void
  onReorder: (
    draggedId: string,
    targetId: string,
    position: TemplateDropPosition,
  ) => void
}

export type TemplateDropPosition = 'before' | 'after'

export function TemplateItem({
  template,
  draggable = false,
  onLoad,
  onReorder,
}: TemplateItemProps) {
  const [dropPosition, setDropPosition] =
    useState<TemplateDropPosition | null>(null)

  const getDropPosition = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  return (
    <Card
      size="small"
      className={`shadow-sm transition-shadow hover:shadow-md ${
        dropPosition === 'before'
          ? 'border-t-2! border-t-blue-500!'
          : dropPosition === 'after'
            ? 'border-b-2! border-b-blue-500!'
            : ''
      }`}
      classNames={{
        body: 'p-[10px]! hover:bg-gray-100 transition-colors duration-100',
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
      <div className="flex gap-2">
        <ImageGroup images={template.images || []} width={80} height={100} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <TemplateItemHeader
            template={template}
            draggable={draggable}
            onLoad={onLoad}
          />
          <div className="flex items-center gap-2">
            {template.title && (
              <div
                className="truncate font-bold text-slate-800"
                title={template.title}
              >
                {template.title}
              </div>
            )}
            <div className="shrink-0 text-xs text-slate-400">
              {dayjs(template.createdAt).format('YY/MM/DD HH:mm')}
            </div>
          </div>
          <Tooltip title={template.prompt} placement="bottom">
            <p
              className="m-0 line-clamp-2 cursor-pointer text-sm text-slate-600 transition-colors hover:text-blue-500"
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
          <div className="ml-2 flex justify-end gap-2 sm:hidden">
            <TemplateItemGenerateButtons template={template} />
          </div>
        </div>
      </div>
    </Card>
  )
}
