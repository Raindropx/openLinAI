import { EditOutlined, FolderOutlined } from '@ant-design/icons'
import { Button, Card } from 'antd'
import { useState } from 'react'
import { RenameFolderModal } from './RenameFolderModal'

interface TemplateFolderProps {
  folder: string
  count: number
  onClick: () => void
  onDropTemplate?: (templateId: string, folder: string) => void
  onRenameSuccess?: () => void
}

export function TemplateFolder({
  folder,
  count,
  onClick,
  onDropTemplate,
  onRenameSuccess,
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
        className={`group cursor-pointer shadow-sm transition-all hover:border-blue-400 hover:shadow-md ${
          isDragOver ? 'border-blue-500 bg-blue-50' : ''
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
                onDropTemplate?.(parsed.id, folder)
              }
            } catch (err) {
              // Ignore parse errors
            }
          }
        }}
      >
        <div className="flex items-center gap-2">
          <FolderOutlined className="text-xl text-blue-500" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-700" title={folder}>
              {folder}
            </div>
            <div className="text-xs text-slate-400">{count} 个模板</div>
          </div>
          <Button
            type="text"
            icon={<EditOutlined />}
            className="opacity-0 transition-opacity group-hover:opacity-100"
            onClick={handleEditClick}
          />
        </div>
      </Card>

      <RenameFolderModal
        folder={folder}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onSuccess={() => {
          setIsModalOpen(false)
          onRenameSuccess?.()
        }}
      />
    </>
  )
}
