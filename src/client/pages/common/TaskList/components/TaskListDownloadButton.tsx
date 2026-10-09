import { DownloadOutlined } from '@ant-design/icons'
import { Button, Modal, message } from 'antd'
import { useState } from 'react'
import type { Task } from '../../../../../server/common/task-manager'
import type { TaskFolder } from '../../../../../shared/task-folders'
import { useLocalSetting } from '../../../../hooks/useLocalSetting'
import { t, useAppLanguage } from '../../../../i18n'
import {
  DOWNLOAD_ZIP_MAX_FILES,
  downloadFile,
  downloadFilesZip,
  formatTaskTimestamp,
  getDownloadErrorMessage,
} from '../../../../utils/download'
import { downloadTaskZip } from '../../../../utils/taskDownload'

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
  const { gptImageSettings } = useLocalSetting()
  const streamDownloads = gptImageSettings.streamTaskDownloads ?? true

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
          <p>
            {t(
              streamDownloads
                ? '批量图片将下载为一个 ZIP，可在浏览器下载记录中查看进度。'
                : '大批量下载按最多 100 张或约 128 MiB 分包，请允许浏览器下载多个文件。',
            )}
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
            (streamDownloads && filesToDownload.length > 1) ||
            filesToDownload.some((file) => file.folder) ||
            filesToDownload.length > DOWNLOAD_ZIP_MAX_FILES
          ) {
            const latestTaskCreatedAt = tasksToDownload.reduce(
              (latest, task) => Math.max(latest, task.createdAt),
              tasksToDownload[0].createdAt,
            )
            const zipName = `${folder?.name || 'tasks'}_${formatTaskTimestamp(latestTaskCreatedAt)}`
            if (streamDownloads) {
              message.loading({
                content: t('正在准备下载...'),
                key: 'download',
                duration: 0,
              })
              await downloadTaskZip(
                tasksToDownload.map((task) => task.id),
                zipName,
                ({ completedFiles, totalFiles }) =>
                  message.loading({
                    content: t('正在下载：{0}/{1} 张', [
                      completedFiles,
                      totalFiles,
                    ]),
                    key: 'download',
                    duration: 0,
                  }),
              )
            } else
              await downloadFilesZip(
                filesToDownload,
                zipName,
                ({ completed, total, part }) =>
                  message.loading({
                    content: t('正在打包：{0}/{1} 张，第 {2} 包', [
                      completed,
                      total,
                      part,
                    ]),
                    key: 'download',
                    duration: 0,
                  }),
              )
            message.success({
              content: t('已发起打包下载，请查看浏览器下载记录'),
              key: 'download',
            })
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
          message.error({
            content: getDownloadErrorMessage(error),
            key: 'download',
            duration: 10,
          })
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
