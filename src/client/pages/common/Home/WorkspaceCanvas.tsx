import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  PictureOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { Button, Image, Spin, Tooltip, message } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import type { Task } from '../../../../server/common/task-manager'
import { useRecentImages } from '../../../hooks/useRecentImages'
import { useTasks } from '../../../hooks/useTasks'
import { useGlobalStore } from '../../../store/global'
import { uploadInputImageFromUrl } from '../../../utils/uploadInputImage'

interface WorkspaceCanvasProps {
  selectedTaskId?: string
  onSelectTask: (taskId: string) => void
}

function getOutputUrls(task: Task) {
  if (task.outputUrls?.length) return task.outputUrls
  return task.outputUrl ? [task.outputUrl] : []
}

function getThumbUrl(url: string) {
  return `${url}${url.includes('?') ? '&' : '?'}thumb=true`
}

export function WorkspaceCanvas({
  selectedTaskId,
  onSelectTask,
}: WorkspaceCanvasProps) {
  const { data: tasks = [], loading } = useTasks()
  const { addRecentImages } = useRecentImages()
  const addReferenceImage = useGlobalStore((state) => state.addReferenceImage)
  const [addingReference, setAddingReference] = useState(false)
  const imageTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.rawTemplate?.usageType === 'image' ||
          task.rawTemplate?.usageType === 'chat-image',
      ),
    [tasks],
  )
  const selectedTask =
    imageTasks.find((task) => task.id === selectedTaskId) ?? imageTasks[0]
  const selectedUrls = selectedTask ? getOutputUrls(selectedTask) : []
  const recentTasks = imageTasks
    .filter((task) => getOutputUrls(task).length > 0)
    .slice(0, 12)

  useEffect(() => {
    if (selectedTask && selectedTask.id !== selectedTaskId) {
      onSelectTask(selectedTask.id)
    }
  }, [onSelectTask, selectedTask, selectedTaskId])

  const status = selectedTask?.status
  const statusMeta =
    status === 'completed'
      ? {
          icon: <CheckCircleFilled />,
          label: '已完成',
          className: 'text-emerald-400',
        }
      : status === 'failed'
        ? {
            icon: <CloseCircleFilled />,
            label: '生成失败',
            className: 'text-red-400',
          }
        : {
            icon: <SyncOutlined spin={status === 'running'} />,
            label: status === 'running' ? '生成中' : '等待中',
            className: 'text-amber-400',
          }

  return (
    <section className="workbench-panel flex h-full min-h-[460px] flex-col lg:min-h-0">
      <div className="workbench-panel-header gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <PictureOutlined className="text-amber-400" />
          <span className="truncate">
            {selectedTask?.rawTemplate?.title || '创作画布'}
          </span>
        </div>
        {selectedTask && (
          <div
            className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${statusMeta.className}`}
          >
            {statusMeta.icon}
            {statusMeta.label}
          </div>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#111318] p-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.045)_0,transparent_58%)]" />
        <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] [background-size:24px_24px] opacity-20" />

        {loading && imageTasks.length === 0 ? (
          <div className="relative flex flex-col items-center gap-3 text-slate-500">
            <Spin />
            <span className="text-sm">正在载入工作区</span>
          </div>
        ) : !selectedTask ? (
          <div className="relative flex max-w-sm flex-col items-center text-center text-slate-500">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#343a44] bg-[#1b1f26] text-3xl text-slate-400">
              <PictureOutlined />
            </div>
            <h2 className="mb-2 text-base font-semibold text-slate-300">
              画布等待生成结果
            </h2>
            <p className="m-0 text-sm leading-6">
              在左侧填写提示词并提交任务，最新结果会自动显示在这里。
            </p>
          </div>
        ) : status === 'failed' ? (
          <div className="relative max-w-md rounded-xl border border-red-500/25 bg-red-500/8 p-6 text-center">
            <CloseCircleFilled className="mb-3 text-3xl text-red-400" />
            <div className="mb-2 font-semibold text-red-300">生成失败</div>
            <div className="text-sm leading-6 text-slate-400">
              {selectedTask.error || '任务未返回可用结果'}
            </div>
          </div>
        ) : selectedUrls.length === 0 ? (
          <div className="relative flex flex-col items-center gap-3 text-slate-400">
            <Spin size="large" />
            <div className="font-medium">
              {status === 'running' ? '正在生成图片' : '任务正在排队'}
            </div>
            <div className="line-clamp-2 max-w-md text-center text-xs leading-5 text-slate-500">
              {selectedTask.rawTemplate?.prompt}
            </div>
          </div>
        ) : (
          <Image.PreviewGroup>
            <div
              className={`relative grid max-h-full max-w-full gap-3 ${
                selectedUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
              }`}
            >
              {selectedUrls.map((url, index) => (
                <div
                  key={`${url}-${index}`}
                  className="flex min-h-0 items-center justify-center overflow-hidden rounded-lg border border-[#343a44] bg-black/35 shadow-2xl"
                >
                  <Image
                    src={url}
                    alt={`生成结果 ${index + 1}`}
                    className="max-h-[calc(100dvh-240px)]! max-w-full! object-contain"
                    styles={{
                      root: {
                        display: 'flex',
                        maxHeight: '100%',
                        maxWidth: '100%',
                      },
                    }}
                  />
                </div>
              ))}
            </div>
          </Image.PreviewGroup>
        )}

        {selectedTask && (
          <div className="canvas-task-meta absolute top-3 left-3 flex items-center overflow-hidden rounded-md border text-[11px] backdrop-blur">
            {selectedUrls[0] && (
              <Tooltip title="将当前图片加入左侧参考图">
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowLeftOutlined />}
                  loading={addingReference}
                  disabled={addingReference}
                  className="canvas-task-meta-button h-7! w-8! rounded-none! border-0! border-r!"
                  onClick={async () => {
                    setAddingReference(true)
                    try {
                      const inputUrl = await uploadInputImageFromUrl(
                        selectedUrls[0],
                      )
                      addReferenceImage(inputUrl)
                      addRecentImages(inputUrl)
                      message.success('已复制到输入区并加入左侧参考图')
                    } catch (error) {
                      message.error(
                        error instanceof Error
                          ? error.message
                          : '加入参考图失败',
                      )
                    } finally {
                      setAddingReference(false)
                    }
                  }}
                />
              </Tooltip>
            )}
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <ClockCircleOutlined />
              {dayjs(selectedTask.createdAt).format('MM/DD HH:mm')}
              {selectedTask.endpointName && (
                <>
                  <span className="canvas-task-meta-separator">·</span>
                  <span className="max-w-28 truncate">
                    {selectedTask.endpointName}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="h-24 shrink-0 border-t border-[#2d333d] bg-[#15181d] p-2.5">
        {recentTasks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            最近生成的图片会显示在这里
          </div>
        ) : (
          <div className="flex h-full gap-2 overflow-x-auto pb-1">
            {recentTasks.map((task) => {
              const url = getOutputUrls(task)[0]
              const active = task.id === selectedTask?.id
              return (
                <button
                  key={task.id}
                  type="button"
                  title={task.rawTemplate?.title || task.rawTemplate?.prompt}
                  onClick={() => onSelectTask(task.id)}
                  className={`relative h-full w-16 shrink-0 cursor-pointer overflow-hidden rounded-md border bg-[#222730] p-0 transition-all ${
                    active
                      ? 'border-amber-400 ring-2 ring-amber-400/20'
                      : 'border-[#343a44] opacity-70 hover:opacity-100'
                  }`}
                >
                  <img
                    src={getThumbUrl(url)}
                    alt="最近生成结果"
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
