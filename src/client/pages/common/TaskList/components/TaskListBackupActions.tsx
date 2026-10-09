import { ExportOutlined, ImportOutlined } from '@ant-design/icons'
import { Button, Modal, Space, message } from 'antd'
import { saveAs } from 'file-saver'
import { useRef, useState } from 'react'
import {
  TASK_BACKUP_MAX_BYTES,
  TASK_BACKUP_STREAM_MAX_BYTES,
} from '../../../../../shared/task-backup'
import { useLocalSetting } from '../../../../hooks/useLocalSetting'
import { t, translateError, useAppLanguage } from '../../../../i18n'
import { useGlobalStore } from '../../../../store/global'
import { formatTaskTimestamp } from '../../../../utils/download'
import { downloadTaskBackup } from '../../../../utils/taskDownload'

interface Props {
  downloadedIds: string[]
  setDownloadedIds: (ids: string[]) => void
  disabled?: boolean
}

async function responseError(response: Response, fallback: string) {
  const result = await response.json().catch(() => ({}))
  return new Error(translateError(result.error || fallback))
}

export function TaskListBackupActions({
  downloadedIds,
  setDownloadedIds,
  disabled,
}: Props) {
  useAppLanguage()
  const { gptImageSettings } = useLocalSetting()
  const streamTransfers = gptImageSettings.streamTaskDownloads ?? true
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'backup' | 'restore'>()
  const working = useRef(false)

  const backup = () => {
    Modal.confirm({
      title: t('备份任务列表'),
      content: (
        <div>
          <p>
            {t(
              '将整个任务列表、文件夹、优化前提示词、生成参数、端点配置、已下载标记及所有引用图片打包为 ZIP。',
            )}
          </p>
          <p>{t('备份包含端点 API Key 和余额令牌，请妥善保管。')}</p>
          <p>
            {t(
              streamTransfers
                ? '流式模式：单个图片上限 64 MiB，ZIP 上限 16 GiB，解压后上限 32 GiB。'
                : '单个图片上限 64 MiB，ZIP 上限 512 MiB，解压后上限 1 GiB。',
            )}
          </p>
        </div>
      ),
      okText: t('备份并下载'),
      cancelText: t('取消'),
      onOk: async () => {
        if (working.current) return
        working.current = true
        setBusy('backup')
        try {
          if (streamTransfers) {
            message.loading({
              content: t('正在准备备份...'),
              key: 'task-backup',
              duration: 0,
            })
            await downloadTaskBackup(
              downloadedIds,
              ({ completedFiles, totalFiles }) =>
                message.loading({
                  content: t('正在备份：{0}/{1} 个文件', [
                    completedFiles,
                    totalFiles,
                  ]),
                  key: 'task-backup',
                  duration: 0,
                }),
            )
            message.success({
              content: t('备份已发送，请查看浏览器下载记录'),
              key: 'task-backup',
            })
            return
          }
          const response = await fetch('/api/task/backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ downloadedTaskIds: downloadedIds }),
          })
          if (!response.ok)
            throw await responseError(response, '备份任务列表失败')
          saveAs(
            await response.blob(),
            `openLinAI-tasks-${formatTaskTimestamp(Date.now())}.zip`,
          )
          message.success(t('任务列表备份已下载'))
        } catch (error) {
          message.error({
            content:
              error instanceof Error ? error.message : t('备份任务列表失败'),
            key: 'task-backup',
            duration: 10,
          })
        } finally {
          working.current = false
          setBusy(undefined)
        }
      },
    })
  }

  const restore = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      message.error(t('请选择任务列表备份 ZIP'))
      return
    }
    if (
      file.size >
      (streamTransfers ? TASK_BACKUP_STREAM_MAX_BYTES : TASK_BACKUP_MAX_BYTES)
    ) {
      message.error(
        t(
          streamTransfers
            ? '流式备份 ZIP 不能超过 16 GiB'
            : '备份 ZIP 不能超过 512 MiB',
        ),
      )
      return
    }
    Modal.confirm({
      title: t('恢复任务列表'),
      content: (
        <div>
          <p className="break-all">{file.name}</p>
          <p>
            {t(
              '备份任务将追加到现有列表，同名文件夹会合并；端点配置冲突时新增端点，保留现有配置。',
            )}
          </p>
          <p>
            {t(
              '恢复会导入备份中的端点和密钥。未完成任务将标记为中断，不会自动生成图片。',
            )}
          </p>
        </div>
      ),
      okText: t('恢复任务列表'),
      cancelText: t('取消'),
      onOk: async () => {
        if (working.current) return
        working.current = true
        setBusy('restore')
        try {
          message.loading({
            content: t('正在上传、校验并恢复备份...'),
            key: 'task-restore',
            duration: 0,
          })
          const response = await fetch(
            streamTransfers ? '/api/task/restore-stream' : '/api/task/restore',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/zip' },
              body: file,
            },
          )
          const result = await response.json()
          if (!response.ok || !result.success)
            throw new Error(translateError(result.error || '恢复任务列表失败'))
          setDownloadedIds([
            ...new Set([...downloadedIds, ...result.downloadedTaskIds]),
          ])
          await useGlobalStore.getState().fetchConfig()
          window.dispatchEvent(new Event('studio-changed'))
          message.success({
            content: t('已恢复 {0} 个任务、{1} 张图片，新增 {2} 个端点', [
              result.taskCount,
              result.imageCount,
              result.endpointCount,
            ]),
            key: 'task-restore',
          })
        } catch (error) {
          message.error({
            content:
              error instanceof Error ? error.message : t('恢复任务列表失败'),
            key: 'task-restore',
            duration: 10,
          })
        } finally {
          working.current = false
          setBusy(undefined)
        }
      },
    })
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) restore(file)
        }}
      />
      <Space.Compact>
        <Button
          icon={<ExportOutlined />}
          title={t('备份任务列表')}
          aria-label={t('备份任务列表')}
          loading={busy === 'backup'}
          disabled={disabled || Boolean(busy)}
          onClick={backup}
        >
          {t('备份')}
        </Button>
        <Button
          icon={<ImportOutlined />}
          title={t('恢复任务列表')}
          aria-label={t('恢复任务列表')}
          loading={busy === 'restore'}
          disabled={disabled || Boolean(busy)}
          onClick={() => input.current?.click()}
        >
          {t('恢复')}
        </Button>
      </Space.Compact>
    </>
  )
}
