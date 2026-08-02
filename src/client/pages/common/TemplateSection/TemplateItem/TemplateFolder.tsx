import {
  EditOutlined,
  FolderOpenOutlined,
  FolderOutlined,
} from '@ant-design/icons'
import { Button, Card } from 'antd'
import { useState } from 'react'
import { RenameFolderModal } from './RenameFolderModal'

interface TemplateFolderProps {
  folder: string
  count: number
  onClick: () => void
  onDropTemplate?: (templateId: string, folder: string) => void
  onRenameSuccess?: () => void
  isParent?: boolean
  dropFolder?: string
}

export function TemplateFolder({
  folder,
  count,
  onClick,
  onDropTemplate,
  onRenameSuccess,
  isParent = false,
  dropFolder,
}: TemplateFolderProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsModalOpen(true)
  }

  return (
    <>
      <Card
        size="small"
        className={`group cursor-pointer border-[#303640]! bg-[#1d2128]! shadow-sm transition-all hover:border-amber-400/70! ${
          isDragOver ? 'border-amber-400! bg-amber-400/10!' : ''
        }`}
        onClick={onClick}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => {
          setIsDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          const data = e.dataTransfer.getData('application/json')
          if (data) {
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'template' && parsed.id) {
                onDropTemplate?.(parsed.id, dropFolder ?? folder)
              }
            } catch (err) {
              // Ignore parse errors
            }
          }
        }}
      >
        <div className="flex items-center gap-2">
          {isParent ? (
            <FolderOpenOutlined className="text-xl text-amber-400" />
          ) : (
            <FolderOutlined className="text-xl text-amber-400" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-200" title={folder}>
              {folder}
            </div>
            <div className="text-xs text-slate-400">
              {isParent ? '拖到这里移出分类' : `${count} 个模板`}
            </div>
          </div>
          {!isParent && (
            <Button
              type="text"
              icon={<EditOutlined />}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={handleEditClick}
            />
          )}
        </div>
      </Card>

      {!isParent && (
        <RenameFolderModal
          folder={folder}
          open={isModalOpen}
          onCancel={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false)
            onRenameSuccess?.()
          }}
        />
      )}
    </>
  )
}
