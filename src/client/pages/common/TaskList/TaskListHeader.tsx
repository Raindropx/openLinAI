import {
  DeleteOutlined,
  EllipsisOutlined,
  ScheduleOutlined,
} from '@ant-design/icons'
import { t, useAppLanguage } from '../../../i18n'

import type { MenuProps } from 'antd'
import { Button, Dropdown, Modal, Space, message } from 'antd'
import { hc } from 'hono/client'
import { useState } from 'react'
import type { AppType } from '../../../../server'
import type { Task } from '../../../../server/common/task-manager'
import type { TaskFolder } from '../../../../shared/task-folders'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { TaskListBackupActions } from './components/TaskListBackupActions'
import { TaskListDownloadButton } from './components/TaskListDownloadButton'
import { TaskListFinishedAlertButton } from './components/TaskListFinishedAlertButton'

const client = hc<AppType>('/')

interface TaskListHeaderProps {
  tasks: Task[]
  downloadedIds: string[]
  setDownloadedIds: (ids: string[]) => void
  loading: boolean
  compact?: boolean
  hideFinishedAlert?: boolean
  management?: boolean
  folders?: TaskFolder[]
}

export function TaskListHeader({
  tasks,
  downloadedIds,
  setDownloadedIds,
  loading,
  compact = false,
  hideFinishedAlert = false,
  management = false,
  folders = [],
}: TaskListHeaderProps) {
  useAppLanguage()

  const { gptImageSettings } = useLocalSetting()
  const [deletingErrors, setDeletingErrors] = useState(false)
  const [deletingDownloaded, setDeletingDownloaded] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const isDeleting = deletingErrors || deletingDownloaded || clearingAll

  const backupActions = management && (
    <TaskListBackupActions
      downloadedIds={downloadedIds}
      setDownloadedIds={setDownloadedIds}
      disabled={loading || isDeleting}
    />
  )

  const handleDeleteErrors = async () => {
    const errorTasks = tasks.filter((t) => t.status === 'failed')
    if (errorTasks.length === 0) {
      message.info(t('没有错误任务'))
      return
    }

    setDeletingErrors(true)
    try {
      let successCount = 0
      for (const task of errorTasks) {
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
          if (json.success) successCount++
        } catch (e) {
          // ignore individual errors
        }
      }
      message.success(t('成功删除 {0} 个错误任务', [successCount]))
    } catch (error) {
      message.error(t('删除错误任务失败'))
    } finally {
      setDeletingErrors(false)
    }
  }

  const handleDeleteDownloaded = () => {
    const toDelete = tasks.filter((t) => downloadedIds.includes(t.id))
    if (toDelete.length === 0) {
      message.info(t('没有已下载的任务'))
      return
    }

    Modal.confirm({
      title: t('确认删除所有已下载任务？'),
      content: (
        <div>
          <p className="mb-2 font-bold text-red-500">
            {gptImageSettings.keepImageWhenDeleteTask
              ? t('警告：将删除任务记录，但图片文件将保留。')
              : t('警告：将删除源文件且无法找回！')}
          </p>
          <p>{t('请确保您已妥善保存好下载的图片。')}</p>
          <p>
            {t('共将删除')} {toDelete.length} {t('个任务。')}
          </p>
        </div>
      ),
      okText: t('确认删除'),
      okType: 'danger',
      onOk: async () => {
        setDeletingDownloaded(true)
        try {
          let successCount = 0
          for (const task of toDelete) {
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
              if (json.success) successCount++
            } catch (e) {
              // ignore individual errors
            }
          }
          message.success(t('成功删除 {0} 个已下载任务', [successCount]))
        } catch (error) {
          message.error(t('批量删除失败'))
        } finally {
          setDeletingDownloaded(false)
        }
      },
    })
  }

  const handleClearAll = () => {
    if (tasks.length === 0) {
      message.info(t('任务列表已经是空的'))
      return
    }

    const tasksToDelete = [...tasks]

    Modal.confirm({
      title: t('☢️ 高危操作：清空整个任务列表？'),
      content: (
        <div>
          <p className="mb-2 font-bold text-red-600">
            {t('这会无视任务是否已经下载，删除列表中的全部')}{' '}
            {tasksToDelete.length} {t('个任务！')}
          </p>
          <p>
            {gptImageSettings.keepImageWhenDeleteTask
              ? t('任务记录将永久删除；根据当前设置，生成的图片文件会保留。')
              : t('任务记录及其生成的图片文件都将永久删除，无法恢复！')}
          </p>
        </div>
      ),
      okText: t('我知道风险，继续'),
      okType: 'danger',
      cancelText: t('取消'),
      onOk: () => {
        Modal.confirm({
          title: t('最后确认：真的要全部清空吗？'),
          content: (
            <p className="font-bold text-red-600">
              {t(
                '这是最后一次确认。执行后无法撤销，也不会检查任务是否已下载。',
              )}
            </p>
          ),
          okText: t('确认清空全部任务'),
          okType: 'danger',
          cancelText: t('返回'),
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
                message.success(t('已清空全部 {0} 个任务', [successCount]))
              } else {
                message.warning(
                  t('已删除 {0} 个任务，{1} 个删除失败', [
                    successCount,
                    tasksToDelete.length - successCount,
                  ]),
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
      label: t('所有错误任务'),
      disabled: isDeleting,
    },
    {
      key: 'delete-downloaded',
      danger: true,
      icon: <DeleteOutlined />,
      label: t('所有已下载任务'),
      disabled: isDeleting,
    },
    {
      key: 'clear-all',
      danger: true,
      icon: <span>☢️</span>,
      label: t('清空任务列表'),
      disabled: isDeleting || tasks.length === 0,
    },
  ]

  if (compact) {
    return (
      <div className="flex shrink-0 flex-col gap-2 border-b border-[#2d333d] py-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {tasks.length} {t('个任务')}
          </span>
          {!hideFinishedAlert && <TaskListFinishedAlertButton tasks={tasks} />}
        </div>
        <Space.Compact className="task-list-download-actions">
          <TaskListDownloadButton
            folders={folders}
            tasks={tasks}
            downloadedIds={downloadedIds}
            setDownloadedIds={setDownloadedIds}
            compactLabel
          />
          <TaskListDownloadButton
            folders={folders}
            tasks={tasks}
            downloadedIds={downloadedIds}
            setDownloadedIds={setDownloadedIds}
            includeDownloaded
            compactLabel
          />
          <Dropdown
            menu={{ items: deleteMenuItems, onClick: onMenuClick }}
            placement="bottomRight"
          >
            <Button
              icon={<EllipsisOutlined />}
              loading={isDeleting}
              aria-label={t('更多操作')}
            />
          </Dropdown>
        </Space.Compact>
      </div>
    )
  }

  const managementMobileHeader = management && (
    <div className="task-list-mobile-header mb-2 flex sm:hidden">
      <h2 className="m-0 text-base font-semibold text-slate-100">
        {t('任务')}{' '}
        <span className="text-xs font-normal text-slate-500">
          {tasks.length}
        </span>
      </h2>
      <Space.Compact className="task-list-download-actions">
        <TaskListDownloadButton
          folders={folders}
          tasks={tasks}
          downloadedIds={downloadedIds}
          setDownloadedIds={setDownloadedIds}
          compactLabel
        />
        <TaskListDownloadButton
          folders={folders}
          tasks={tasks}
          downloadedIds={downloadedIds}
          setDownloadedIds={setDownloadedIds}
          includeDownloaded
          compactLabel
        />
        <Dropdown
          menu={{ items: deleteMenuItems, onClick: onMenuClick }}
          placement="bottomRight"
        >
          <Button
            icon={<EllipsisOutlined />}
            loading={isDeleting}
            aria-label={t('更多操作')}
          />
        </Dropdown>
      </Space.Compact>
    </div>
  )

  const standardHeader = (
    <div
      className={`${management ? 'hidden sm:flex' : 'flex'} mt-4 mb-4 items-center justify-between`}
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="app-accent-surface hidden items-center justify-center rounded-lg p-2 sm:flex">
            <ScheduleOutlined className="text-xl" />
          </div>
          <h2 className="text-lg font-bold">{t('任务列表')}</h2>
        </div>

        {!hideFinishedAlert && (
          <Space className="ml-4">
            <TaskListFinishedAlertButton tasks={tasks} />
          </Space>
        )}
      </div>

      <div className="flex gap-4">
        <div className="hidden xl:block">
          <Space.Compact>
            <TaskListDownloadButton
              folders={folders}
              tasks={tasks}
              downloadedIds={downloadedIds}
              setDownloadedIds={setDownloadedIds}
            />
            <TaskListDownloadButton
              folders={folders}
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
              {t('所有错误任务')}
            </Button>
            <Button
              className="w-32 px-1"
              danger
              icon={<DeleteOutlined />}
              onClick={handleDeleteDownloaded}
              loading={deletingDownloaded}
              disabled={isDeleting}
            >
              {t('所有已下载任务')}
            </Button>
            <Button
              className="w-32 px-1"
              danger
              icon={<span>☢️</span>}
              onClick={handleClearAll}
              loading={clearingAll}
              disabled={isDeleting || tasks.length === 0}
            >
              {t('清空任务列表')}
            </Button>
          </Space.Compact>
        </div>

        <div className="block xl:hidden">
          <Space.Compact>
            <TaskListDownloadButton
              folders={folders}
              tasks={tasks}
              downloadedIds={downloadedIds}
              setDownloadedIds={setDownloadedIds}
            />
            <TaskListDownloadButton
              folders={folders}
              tasks={tasks}
              downloadedIds={downloadedIds}
              setDownloadedIds={setDownloadedIds}
              includeDownloaded
            />

            <Dropdown
              menu={{ items: deleteMenuItems, onClick: onMenuClick }}
              placement="bottomRight"
            >
              <Button icon={<EllipsisOutlined />} loading={isDeleting} />
            </Dropdown>
          </Space.Compact>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {managementMobileHeader}
      {standardHeader}
      {backupActions && (
        <div className="mb-2 flex justify-end sm:mb-4">{backupActions}</div>
      )}
    </>
  )
}
