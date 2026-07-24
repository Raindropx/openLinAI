import { DownloadOutlined } from '@ant-design/icons'
import { Button, Modal, message } from 'antd'
import { useState } from 'react'
import type { Task } from '../../../../../server/common/task-manager'
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
}

export function TaskListDownloadButton({
  tasks,
  downloadedIds,
  setDownloadedIds,
  includeDownloaded = false,
}: TaskListDownloadButtonProps) {
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
      message.info('没有需要下载的任务')
      return
    }

    const filesToDownload = tasksToDownload.flatMap((task) => {
      const baseName =
        task.rawTemplate?.title ||
        task.rawTemplate?.prompt ||
        `task_${task.id}`

      return task.outputUrls!.map((url, index) => ({
        url,
        fileName:
          task.outputUrls!.length > 1 ? `${baseName}_${index + 1}` : baseName,
        id: `${task.id}_${index}`,
        endpointName: task.endpointName,
        createdAt: task.createdAt,
      }))
    })

    Modal.confirm({
      title: '确认下载',
      content: (
        <div>
          <p>任务数量：{tasksToDownload.length}</p>
          <p>图片数量：{filesToDownload.length}</p>
        </div>
      ),
      okText: '确认下载',
      cancelText: '取消',
      okButtonProps: { style: { width: 96 } },
      cancelButtonProps: { style: { width: 96 } },
      onOk: async () => {
        setDownloading(true)
        try {
          if (
            includeDownloaded ||
            filesToDownload.length > DOWNLOAD_ZIP_MAX_FILES
          ) {
            message.loading({ content: '正在打包压缩...', key: 'download' })
            const latestTaskCreatedAt = Math.max(
              ...tasksToDownload.map((task) => task.createdAt),
            )
            await downloadFilesZip(
              filesToDownload,
              `tasks_${formatTaskTimestamp(latestTaskCreatedAt)}`,
            )
            message.success({ content: '打包下载完成', key: 'download' })
          } else {
            message.loading({ content: '正在下载...', key: 'download' })
            await Promise.all(
              filesToDownload.map((file) =>
                downloadFile(file).catch((error) => {
                  console.error(`下载任务 ${file.id} 失败`, error)
                }),
              ),
            )
            message.success({ content: '下载完成', key: 'download' })
          }

          // 标记为已下载
          setDownloadedIds([
            ...new Set([
              ...downloadedIds,
              ...tasksToDownload.map((task) => task.id),
            ]),
          ])
        } catch (error) {
          message.error({ content: '下载失败', key: 'download' })
        } finally {
          setDownloading(false)
        }
      },
    })
  }

  return (
    <Button
      className="md:w-32 md:px-1"
      icon={<DownloadOutlined />}
      onClick={handleDownloadAll}
      loading={downloading}
    >
      {includeDownloaded ? '所有任务' : '所有未下载'}
    </Button>
  )
}
