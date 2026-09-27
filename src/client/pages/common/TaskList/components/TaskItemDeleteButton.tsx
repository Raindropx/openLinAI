import { DeleteOutlined } from '@ant-design/icons'
import { useLocalStorageState } from 'ahooks'
import { Button, Checkbox, message, Modal, Tooltip } from 'antd'
import { hc } from 'hono/client'
import type { AppType } from '../../../../../server'
import { useLocalSetting } from '../../../../hooks/useLocalSetting'
import { t, useAppLanguage } from '../../../../i18n'

const client = hc<AppType>('/')

interface DeleteTaskButtonProps {
  id: string
  status?: string
  onSuccess?: () => void
}

export function TaskItemDeleteButton({
  id,
  status,
  onSuccess,
}: DeleteTaskButtonProps) {
  useAppLanguage()

  const { gptImageSettings } = useLocalSetting()
  const [, setSkipDeleteConfirm] = useLocalStorageState(
    'skipDeleteTaskConfirm',
    {
      defaultValue: false,
    },
  )

  const doDelete = async () => {
    try {
      const res = await client.api.task[':id'].$delete({
        param: { id },
        query: {
          keepImage: gptImageSettings.keepImageWhenDeleteTask
            ? 'true'
            : 'false',
        },
      })
      const json = await res.json()
      if (json.success) {
        message.success(t('删除成功'))
        onSuccess?.()
      } else {
        message.error(t(json.error || '') || t('删除失败'))
      }
    } catch (error) {
      message.error(t('删除失败'))
    }
  }

  const handleDelete = () => {
    // 直接从 localStorage 读取最新值，避免任务列表中各实例状态不同步导致“下次不再提醒”失效
    let skip = false
    try {
      const raw = localStorage.getItem('skipDeleteTaskConfirm')
      skip = raw === null ? false : JSON.parse(raw) === true
    } catch {
      skip = false
    }
    if (skip || status === 'failed') {
      doDelete()
      return
    }

    let skipNext = false

    Modal.confirm({
      title: t('确认删除任务？'),
      content: (
        <div>
          <p>
            {gptImageSettings.keepImageWhenDeleteTask
              ? t('删除任务不会删除其生成的图片文件。')
              : t('删除任务将同时删除其生成的图片文件，且不可恢复。')}
          </p>
          <Checkbox
            onChange={(e) => {
              skipNext = e.target.checked
            }}
          >
            {t('下次不再提醒')}
          </Checkbox>
        </div>
      ),
      okText: t('确认删除'),
      okType: 'danger',
      onOk: () => {
        if (skipNext) {
          setSkipDeleteConfirm(true)
        }
        doDelete()
      },
    })
  }

  return (
    <Tooltip title={t('删除')}>
      <Button
        type="text"
        danger
        icon={<DeleteOutlined />}
        onClick={handleDelete}
      />
    </Tooltip>
  )
}
