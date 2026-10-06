import { DownloadOutlined } from '@ant-design/icons'
import { Button, Modal, message } from 'antd'
import { useState } from 'react'
import type { Task } from '../../../../../server/common/task-manager'
import type { TaskFolder } from '../../../../../shared/task-folders'
import { t, useAppLanguage } from '../../../../i18n'
import {
  DOWNLOAD_ZIP_MAX_FILES,
  downloadFile,
  downloadFilesZip,
  formatTaskTimestamp,
} from '../../../../utils/download'

interface TaskListDownloadButtonProps {
  tasks: Task[]
  downloadedIds: string[]
  setDownloadedIds: (ids: string[]) => void
  includeDownloaded?: boolean
  compactLabel?: boolean
  folders?: TaskFolder[]
  folder?: TaskFolder
  iconOnly?: boolean
}

export function TaskListDownloadButton({
  tasks,
  downloadedIds,
  setDownloadedIds,
  includeDownloaded = false,
  compactLabel = false,
  folders = [],
  folder,
  iconOnly = false,
}: TaskListDownloadButtonProps) {
  useAppLanguage()

  const [downloading, setDownloading] = useState(false)

  const handleDownloadAll = () => {
    const tasksToDownload = tasks.filter(
      (t) =>
        t.status === 'completed' &&
        t.outputUrls &&
        t.outputUrls.length > 0 &&
        (includeDownloaded || !downloadedIds.includes(t.id)),
    )

    if (tasksToDownload.length === 0) {
      message.info(t('没有需要下载的任务'))
      return
    }

    const filesToDownload = tasksToDownload.flatMap((task) => {
      const baseName =
        task.rawTemplate?.title || task.rawTemplate?.prompt || `task_${task.id}`

      return task.outputUrls!.map((url, index) => ({
        url,
        fileName:
          task.outputUrls!.length > 1 ? `${baseName}_${index + 1}` : baseName,
        id: `${task.id}_${index}`,
        endpointName: task.endpointName,
        createdAt: task.createdAt,
        folder: folders.find((folder) => folder.id === task.folderId)?.name,
      }))
    })

    Modal.confirm({
      title: t('确认下载'),
      content: (
        <div>
          <p>
            {t('任务数量：')}
            {tasksToDownload.length}
          </p>
          <p>
            {t('图片数量：')}
            {filesToDownload.length}
          </p>
        </div>
      ),
      okText: t('确认下载'),
      cancelText: t('取消'),
      okButtonProps: { style: { width: 96 } },
      cancelButtonProps: { style: { width: 96 } },
      onOk: async () => {
        setDownloading(true)
        try {
          if (
            includeDownloaded ||
            filesToDownload.some((file) => file.folder) ||
            filesToDownload.length > DOWNLOAD_ZIP_MAX_FILES
          ) {
            message.loading({ content: t('正在打包压缩...'), key: 'download' })
            const latestTaskCreatedAt = Math.max(
              ...tasksToDownload.map((task) => task.createdAt),
            )
            await downloadFilesZip(
              filesToDownload,
              `${folder?.name || 'tasks'}_${formatTaskTimestamp(latestTaskCreatedAt)}`,
            )
            message.success({ content: t('打包下载完成'), key: 'download' })
          } else {
            message.loading({ content: t('正在下载...'), key: 'download' })
            await Promise.all(filesToDownload.map((file) => downloadFile(file)))
            message.success({ content: t('下载完成'), key: 'download' })
          }

          // 标记为已下载
          setDownloadedIds([
            ...new Set([
              ...downloadedIds,
              ...tasksToDownload.map((task) => task.id),
            ]),
          ])
        } catch (error) {
          message.error({ content: t('下载失败'), key: 'download' })
        } finally {
          setDownloading(false)
        }
      },
    })
  }

  const label = folder
    ? t('下载文件夹')
    : includeDownloaded
      ? t('所有任务')
      : t('所有未下载')

  return (
    <Button
      className={
        folder || iconOnly
          ? undefined
          : 'task-list-download-button md:w-32 md:px-1'
      }
      title={label}
      aria-label={label}
      icon={<DownloadOutlined />}
      onClick={handleDownloadAll}
      loading={downloading}
    >
      {iconOnly
        ? null
        : compactLabel && !folder
          ? includeDownloaded
            ? t('全部')
            : t('未下载')
          : label}
    </Button>
  )
}
