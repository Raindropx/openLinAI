import { DownloadOutlined } from '@ant-design/icons'
import { Button, message, Tooltip } from 'antd'
import {
  DOWNLOAD_ZIP_MAX_FILES,
  downloadFile,
  downloadFilesZip,
  getTaskDownloadName,
} from '../../../../utils/download'

export const TaskItemDownloadButton = ({
  outputUrls,
  fileName,
  endpointName,
  createdAt,
  onDownloaded,
}: {
  outputUrls: string[]
  fileName: string
  endpointName?: string
  createdAt: number
  onDownloaded: () => void
}) => {
  const handleDownload = async () => {
    if (!outputUrls || outputUrls.length === 0) {
      message.info('没有需要下载的文件')
      return
    }

    try {
      if (outputUrls.length > DOWNLOAD_ZIP_MAX_FILES) {
        message.loading({ content: '正在打包压缩...', key: 'download' })
        const filesToDownload = outputUrls.map((url, index) => ({
          url,
          fileName:
            outputUrls.length > 1 ? `${fileName}_${index + 1}` : fileName,
          id: `${index}`,
          endpointName,
          createdAt,
        }))
        await downloadFilesZip(
          filesToDownload,
          getTaskDownloadName(fileName, endpointName, createdAt),
        )
        message.success({ content: '打包下载完成', key: 'download' })
      } else {
        message.loading({ content: '正在下载...', key: 'download' })
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
        message.success({ content: '下载完成', key: 'download' })
      }
      onDownloaded()
    } catch (err) {
      message.error({ content: '下载失败', key: 'download' })
    }
  }

  return (
    <Tooltip title="下载">
      <Button
        type="text"
        icon={<DownloadOutlined />}
        onClick={() => handleDownload()}
      />
    </Tooltip>
  )
}
