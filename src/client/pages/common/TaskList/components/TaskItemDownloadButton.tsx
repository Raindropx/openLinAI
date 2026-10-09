import { DownloadOutlined } from '@ant-design/icons'
import { Button, message, Tooltip } from 'antd'
import { useState } from 'react'
import { useLocalSetting } from '../../../../hooks/useLocalSetting'
import { t, useAppLanguage } from '../../../../i18n'
import {
  DOWNLOAD_ZIP_MAX_FILES,
  downloadFile,
  downloadFilesZip,
  getDownloadErrorMessage,
  getTaskDownloadName,
} from '../../../../utils/download'
import { downloadTaskZip } from '../../../../utils/taskDownload'

export const TaskItemDownloadButton = ({
  taskId,
  outputUrls,
  fileName,
  endpointName,
  createdAt,
  folder,
  onDownloaded,
}: {
  taskId: string
  outputUrls: string[]
  fileName: string
  endpointName?: string
  createdAt: number
  folder?: string
  onDownloaded: () => void
}) => {
  useAppLanguage()
  const { gptImageSettings } = useLocalSetting()
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    if (!outputUrls || outputUrls.length === 0) {
      message.info(t('没有需要下载的文件'))
      return
    }

    setDownloading(true)
    try {
      if (
        ((gptImageSettings.streamTaskDownloads ?? true) &&
          outputUrls.length > 1) ||
        (folder && outputUrls.length > 1) ||
        outputUrls.length > DOWNLOAD_ZIP_MAX_FILES
      ) {
        message.loading({ content: t('正在打包压缩...'), key: 'download' })
        const filesToDownload = outputUrls.map((url, index) => ({
          url,
          fileName:
            outputUrls.length > 1 ? `${fileName}_${index + 1}` : fileName,
          id: `${index}`,
          endpointName,
          createdAt,
          folder,
        }))
        const zipName = getTaskDownloadName(fileName, endpointName, createdAt)
        if (gptImageSettings.streamTaskDownloads ?? true) {
          await downloadTaskZip(
            [taskId],
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
        await Promise.all(
          outputUrls.map((url, index) => {
            const downloadFileName =
              outputUrls.length > 1 ? `${fileName}_${index + 1}` : fileName
            return downloadFile({
              url,
              fileName: downloadFileName,
              id: `${index}`,
              endpointName,
              createdAt,
            })
          }),
        )
        message.success({ content: t('下载完成'), key: 'download' })
      }
      onDownloaded()
    } catch (err) {
      message.error({
        content: getDownloadErrorMessage(err),
        key: 'download',
        duration: 10,
      })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Tooltip title={t('下载')}>
      <Button
        type="text"
        icon={<DownloadOutlined />}
        loading={downloading}
        onClick={() => handleDownload()}
      />
    </Tooltip>
  )
}
