import {
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FolderOpenOutlined,
  FolderOutlined,
} from '@ant-design/icons'
import { Button, Card, Dropdown } from 'antd'
import { useState } from 'react'
import type { Task } from '../../../../../server/common/task-manager'
import type { TaskFolder } from '../../../../../shared/task-folders'
import { t, useAppLanguage } from '../../../../i18n'
import { TaskListDownloadButton } from './TaskListDownloadButton'

interface Props {
  folder?: TaskFolder
  tasks: Task[]
  folders: TaskFolder[]
  downloadedIds: string[]
  setDownloadedIds: (ids: string[]) => void
  onOpen: () => void
  onMove: (ids: string[], folderId: string) => void
  onRename?: () => void
  onDelete?: () => void
}

export function TaskFolderCard({
  folder,
  tasks,
  folders,
  downloadedIds,
  setDownloadedIds,
  onOpen,
  onMove,
  onRename,
  onDelete,
}: Props) {
  useAppLanguage()
  const [dragOver, setDragOver] = useState(false)
  return (
    <Card
      size="small"
      role="button"
      tabIndex={0}
      className={`template-folder-card cursor-pointer ${dragOver ? 'template-folder-card-drag-over' : ''}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('application/x-linai-task'))
          return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDragOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        try {
          const ids: unknown = JSON.parse(
            event.dataTransfer.getData('application/x-linai-task'),
          )
          if (
            Array.isArray(ids) &&
            ids.length &&
            ids.every((id) => typeof id === 'string')
          )
            onMove(ids, folder?.id || '')
        } catch {
          /* Ignore unrelated drops. */
        }
      }}
    >
      <div className="flex items-center gap-2">
        {folder ? (
          <FolderOutlined className="app-accent-text text-xl" />
        ) : (
          <FolderOpenOutlined className="app-accent-text text-xl" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={folder?.name}>
            {folder?.name || '..'}
          </div>
          <div className="text-xs text-slate-400">
            {folder
              ? t('{0} 个任务', [tasks.length])
              : t('拖到这里移回主文件夹')}
          </div>
        </div>
        {folder && (
          <div
            className="flex items-center"
            onClick={(event) => event.stopPropagation()}
          >
            <TaskListDownloadButton
              tasks={tasks}
              folders={folders}
              folder={folder}
              downloadedIds={downloadedIds}
              setDownloadedIds={setDownloadedIds}
              includeDownloaded
              iconOnly
            />
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'rename',
                    label: t('重命名'),
                    icon: <EditOutlined />,
                    onClick: onRename,
                  },
                  {
                    key: 'delete',
                    label: t('删除文件夹'),
                    icon: <DeleteOutlined />,
                    danger: true,
                    onClick: onDelete,
                  },
                ],
              }}
            >
              <Button
                type="text"
                icon={<EllipsisOutlined />}
                aria-label={t('文件夹操作')}
              />
            </Dropdown>
          </div>
        )}
      </div>
    </Card>
  )
}
