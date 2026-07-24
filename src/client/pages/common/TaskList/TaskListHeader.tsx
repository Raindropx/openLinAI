import {
  DeleteOutlined,
  EllipsisOutlined,
  ScheduleOutlined,
} from '@ant-design/icons'

import type { MenuProps } from 'antd'
import { Button, Dropdown, Modal, Space, message } from 'antd'
import { hc } from 'hono/client'
import { useState } from 'react'
import type { AppType } from '../../../../server'
import type { Task } from '../../../../server/common/task-manager'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { TaskListDownloadButton } from './components/TaskListDownloadButton'
import { TaskListFinishedAlertButton } from './components/TaskListFinishedAlertButton'

const client = hc<AppType>('/')

interface TaskListHeaderProps {
  tasks: Task[]
  downloadedIds: string[]
  setDownloadedIds: (ids: string[]) => void
  loading: boolean
}

export function TaskListHeader({
  tasks,
  downloadedIds,
  setDownloadedIds,
}: TaskListHeaderProps) {
  const { gptImageSettings } = useLocalSetting()
  const [deletingErrors, setDeletingErrors] = useState(false)
  const [deletingDownloaded, setDeletingDownloaded] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const isDeleting = deletingErrors || deletingDownloaded || clearingAll

  const handleDeleteErrors = async () => {
    const errorTasks = tasks.filter((t) => t.status === 'failed')
    if (errorTasks.length === 0) {
      message.info('没有错误任务')
      return
    }

    setDeletingErrors(true)
    try {
      let successCount = 0
      for (const task of errorTasks) {
        try {
          const res = await client.api.task[':id'].$delete({
            param: { id: task.id },
            query: { keepImage: gptImageSettings.keepImageWhenDeleteTask ? 'true' : 'false' },
          })
          const json = await res.json()
          if (json.success) successCount++
        } catch (e) {
          // ignore individual errors
        }
      }
      message.success(`成功删除 ${successCount} 个错误任务`)
    } catch (error) {
      message.error('删除错误任务失败')
    } finally {
      setDeletingErrors(false)
    }
  }

  const handleDeleteDownloaded = () => {
    const toDelete = tasks.filter((t) => downloadedIds.includes(t.id))
    if (toDelete.length === 0) {
      message.info('没有已下载的任务')
      return
    }

    Modal.confirm({
      title: '确认删除所有已下载任务？',
      content: (
        <div>
          <p className="mb-2 font-bold text-red-500">
            {gptImageSettings.keepImageWhenDeleteTask
              ? '警告：将删除任务记录，但图片文件将保留。'
              : '警告：将删除源文件且无法找回！'}
          </p>
          <p>请确保您已妥善保存好下载的图片。</p>
          <p>共将删除 {toDelete.length} 个任务。</p>
        </div>
      ),
      okText: '确认删除',
      okType: 'danger',
      onOk: async () => {
        setDeletingDownloaded(true)
        try {
          let successCount = 0
          for (const task of toDelete) {
            try {
              const res = await client.api.task[':id'].$delete({
                param: { id: task.id },
                query: { keepImage: gptImageSettings.keepImageWhenDeleteTask ? 'true' : 'false' },
              })
              const json = await res.json()
              if (json.success) successCount++
            } catch (e) {
              // ignore individual errors
            }
          }
          message.success(`成功删除 ${successCount} 个已下载任务`)
        } catch (error) {
          message.error('批量删除失败')
        } finally {
          setDeletingDownloaded(false)
        }
      },
    })
  }

  const handleClearAll = () => {
    if (tasks.length === 0) {
      message.info('任务列表已经是空的')
      return
    }

    const tasksToDelete = [...tasks]

    Modal.confirm({
      title: '☢️ 高危操作：清空整个任务列表？',
      content: (
        <div>
          <p className="mb-2 font-bold text-red-600">
            这会无视任务是否已经下载，删除列表中的全部 {tasksToDelete.length}{' '}
            个任务！
          </p>
          <p>
            {gptImageSettings.keepImageWhenDeleteTask
              ? '任务记录将永久删除；根据当前设置，生成的图片文件会保留。'
              : '任务记录及其生成的图片文件都将永久删除，无法恢复！'}
          </p>
        </div>
      ),
      okText: '我知道风险，继续',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        Modal.confirm({
          title: '最后确认：真的要全部清空吗？',
          content: (
            <p className="font-bold text-red-600">
              这是最后一次确认。执行后无法撤销，也不会检查任务是否已下载。
            </p>
          ),
          okText: '确认清空全部任务',
          okType: 'danger',
          cancelText: '返回',
          onOk: async () => {
            setClearingAll(true)
            try {
              let successCount = 0
              const deletedIds = new Set<string>()
              for (const task of tasksToDelete) {
                try {
                  const res = await client.api.task[':id'].$delete({
                    param: { id: task.id },
                    query: {
                      keepImage: gptImageSettings.keepImageWhenDeleteTask
                        ? 'true'
                        : 'false',
                    },
                  })
                  const json = await res.json()
                  if (json.success) {
                    successCount++
                    deletedIds.add(task.id)
                  }
                } catch (e) {
                  // Continue clearing the remaining tasks.
                }
              }

              setDownloadedIds(
                downloadedIds.filter((id) => !deletedIds.has(id)),
              )

              if (successCount === tasksToDelete.length) {
                message.success(`已清空全部 ${successCount} 个任务`)
              } else {
                message.warning(
                  `已删除 ${successCount} 个任务，${tasksToDelete.length - successCount} 个删除失败`,
                )
              }
            } finally {
              setClearingAll(false)
            }
          },
        })
      },
    })
  }

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'delete-errors') {
      handleDeleteErrors()
    } else if (key === 'delete-downloaded') {
      handleDeleteDownloaded()
    } else if (key === 'clear-all') {
      handleClearAll()
    }
  }

  const deleteMenuItems: MenuProps['items'] = [
    {
      key: 'delete-errors',
      danger: true,
      icon: <DeleteOutlined />,
      label: '所有错误任务',
      disabled: isDeleting,
    },
    {
      key: 'delete-downloaded',
      danger: true,
      icon: <DeleteOutlined />,
      label: '所有已下载任务',
      disabled: isDeleting,
    },
    {
      key: 'clear-all',
      danger: true,
      icon: <span>☢️</span>,
      label: '清空任务列表',
      disabled: isDeleting || tasks.length === 0,
    },
  ]

  return (
    <div className="mt-4 mb-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="hidden items-center justify-center rounded-lg bg-blue-100 p-2 text-blue-600 sm:flex">
            <ScheduleOutlined className="text-xl" />
          </div>
          <h2 className="text-lg font-bold">任务列表</h2>
        </div>

        <Space className="ml-4">
          <TaskListFinishedAlertButton tasks={tasks} />
        </Space>
      </div>

      <div className="flex gap-4">
        <div className="hidden md:block">
          <Space.Compact>
            <TaskListDownloadButton
              tasks={tasks}
              downloadedIds={downloadedIds}
              setDownloadedIds={setDownloadedIds}
            />
            <TaskListDownloadButton
              tasks={tasks}
              downloadedIds={downloadedIds}
              setDownloadedIds={setDownloadedIds}
              includeDownloaded
            />
            <Button
              className="w-32 px-1"
              danger
              icon={<DeleteOutlined />}
              onClick={handleDeleteErrors}
              loading={deletingErrors}
              disabled={isDeleting}
            >
              所有错误任务
            </Button>
            <Button
              className="w-32 px-1"
              danger
              icon={<DeleteOutlined />}
              onClick={handleDeleteDownloaded}
              loading={deletingDownloaded}
              disabled={isDeleting}
            >
              所有已下载任务
            </Button>
            <Button
              className="w-32 px-1"
              danger
              icon={<span>☢️</span>}
              onClick={handleClearAll}
              loading={clearingAll}
              disabled={isDeleting || tasks.length === 0}
            >
              清空任务列表
            </Button>
          </Space.Compact>
        </div>

        <div className="block md:hidden">
          <Space.Compact>
            <TaskListDownloadButton
              tasks={tasks}
              downloadedIds={downloadedIds}
              setDownloadedIds={setDownloadedIds}
            />
            <TaskListDownloadButton
              tasks={tasks}
              downloadedIds={downloadedIds}
              setDownloadedIds={setDownloadedIds}
              includeDownloaded
            />

            <Dropdown
              menu={{ items: deleteMenuItems, onClick: onMenuClick }}
              placement="bottomRight"
            >
              <Button
                icon={<EllipsisOutlined />}
                loading={isDeleting}
              />
            </Dropdown>
          </Space.Compact>
        </div>
      </div>
    </div>
  )
}
