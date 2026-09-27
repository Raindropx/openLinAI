import { ArrowRightOutlined } from '@ant-design/icons'
import { Button, Dropdown, Tooltip, message } from 'antd'
import { useState } from 'react'
import { t, useAppLanguage } from '../../../i18n'
import { copyTaskImageToStudio } from './api'

export function CopyToStudioButton({
  taskId,
  count = 1,
  imageIndex,
  className,
}: {
  taskId: string
  count?: number
  imageIndex?: number
  className?: string
}) {
  useAppLanguage()

  const [busy, setBusy] = useState(false)
  const copy = async (index: number) => {
    if (busy) return
    setBusy(true)
    try {
      await copyTaskImageToStudio(taskId, index)
      message.success(t('已复制到工作室暂存台'))
    } catch (error) {
      message.error(error instanceof Error ? t(error.message) : t('复制失败'))
    } finally {
      setBusy(false)
    }
  }
  const button = (
    <Button
      type="text"
      size="small"
      icon={<ArrowRightOutlined />}
      loading={busy}
      disabled={busy}
      className={className}
      aria-label={t('复制到暂存台')}
      onClick={
        count > 1 && imageIndex === undefined
          ? undefined
          : () => void copy(imageIndex ?? 0)
      }
    />
  )
  return count > 1 && imageIndex === undefined ? (
    <Dropdown
      menu={{
        items: Array.from({ length: count }, (_, index) => ({
          key: String(index),
          label: t('图片 {0}', [index + 1]),
        })),
        onClick: ({ key }) => void copy(Number(key)),
      }}
      trigger={['click']}
    >
      <Tooltip title={t('选择图片复制到暂存台')}>{button}</Tooltip>
    </Dropdown>
  ) : (
    <Tooltip title={t('复制到暂存台')}>{button}</Tooltip>
  )
}
