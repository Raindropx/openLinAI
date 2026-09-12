import {
  BulbOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
  FileAddOutlined,
  GlobalOutlined,
  RedoOutlined,
  SyncOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons'
import { useLocalStorageState } from 'ahooks'
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Image,
  Modal,
  Pagination,
  Spin,
  Tooltip,
  Typography,
  message,
} from 'antd'
import copy from 'copy-to-clipboard'
import dayjs from 'dayjs'
import { hc } from 'hono/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppType } from '../../../../server'
import type { Task } from '../../../../server/common/task-manager'
import { TRIAL_TEMPLATE_TITLE } from '../../../../server/common/template-manager/enum'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { useTasks } from '../../../hooks/useTasks'
import { ImageGroup } from '../../../pages/common/components/ImageGroup'
import { useGlobalStore } from '../../../store/global'
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel'
import {
  ListToolbar,
  sortListItems,
  type ListSortMode,
} from '../components/ListToolbar'
import { TaskListHeader } from './TaskListHeader'
import { TaskItemDeleteButton } from './components/TaskItemDeleteButton'
import { TaskItemDownloadButton } from './components/TaskItemDownloadButton'
import { TaskItemTags } from './components/TaskItemTags'
import {
  TaskReviewPreview,
  type ReviewImage,
} from './components/TaskReviewPreview'

const client = hc<AppType>('/')

interface TaskListProps {
  variant?: 'default' | 'panel' | 'management'
  selectedTaskId?: string
  onSelectTask?: (taskId: string) => void
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`
  }
  return `${bytes}B`
}

function TaskImage({
  src,
  showSize,
  preview = true,
  onPreview,
}: {
  src: string
  showSize: boolean
  preview?: boolean
  onPreview?: () => void
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  )
  const [fileSize, setFileSize] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const width = size?.width ?? 0
  const height = size?.height ?? 0

  const handleLoaded = useCallback((image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return
    setSize({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })
  }, [])

  useEffect(() => {
    setSize(null)
    const image = rootRef.current?.querySelector('img')
    if (image?.complete) {
      handleLoaded(image)
    }
  }, [handleLoaded, src])

  useEffect(() => {
    setFileSize(null)
    if (!showSize || !width || !height) return

    const controller = new AbortController()
    fetch(src, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return response.blob()
      })
      .then((blob) => setFileSize(blob.size))
      .catch(() => {})

    return () => controller.abort()
  }, [height, showSize, src, width])

  return (
    <>
      <div ref={rootRef} className="contents">
        <Image
          src={src}
          alt="result"
          preview={onPreview ? false : preview}
          onClick={
            onPreview
              ? (event) => {
                  event.stopPropagation()
                  onPreview()
                }
              : undefined
          }
          classNames={{
            root: 'w-full h-full',
            image: `w-full! h-full! object-cover${onPreview ? ' cursor-pointer' : ''}`,
          }}
          onLoad={(event) => {
            handleLoaded(event.target as HTMLImageElement)
          }}
        />
      </div>
      {showSize && size && (
        <div className="pointer-events-none absolute top-0 left-0 z-10 rounded-br bg-black/55 px-1 text-[10px] leading-4 text-white">
          {size.width}×{size.height}
          {fileSize !== null && ` · ${formatFileSize(fileSize)}`}
        </div>
      )}
    </>
  )
}

export function TaskList({
  variant = 'default',
  selectedTaskId,
  onSelectTask,
}: TaskListProps) {
  const panelMode = variant === 'panel'
  const managementMode = variant === 'management'
  const navigate = useNavigate()
  const { data: tasks = [], loading } = useTasks()
  const { gptImageSettings } = useLocalSetting()
  const endpoints = useGlobalStore((state) => state.endpoints)
  const [downloadedIds, setDownloadedIds] = useLocalStorageState<string[]>(
    'downloadedTaskIds',
    { defaultValue: [] },
  )
  const [page, setPage] = useState(0)
  const infiniteScroll = panelMode
    ? (gptImageSettings.workspaceListInfiniteScroll ?? true)
    : (gptImageSettings.taskManagerInfiniteScroll ?? true)
  const pageSize = panelMode
    ? (gptImageSettings.workspaceListPageSize ?? 8)
    : (gptImageSettings.taskManagerPageSize ?? 12)
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const [searchText, setSearchText] = useState('')
  const [sortMode, setSortMode] = useState<ListSortMode>('default')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [reviewImage, setReviewImage] = useState<ReviewImage | null>(null)
  const [reviewedTaskId, setReviewedTaskId] = useState<string | null>(null)
  const [originalPromptView, setOriginalPromptView] = useState<{
    text: string
  } | null>(null)
  const taskCardRefs = useRef(new Map<string, HTMLDivElement>())
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const focusNewestTaskSignal = useGlobalStore(
    (state) => state.focusNewestTaskSignal,
  )
  const lastFocusSignalRef = useRef(0)

  const handleAddToTemplate = (task: Task) => {
    if (!task.rawTemplate) return
    useGlobalStore.getState().setFillTemplateData(task.rawTemplate)
    navigate('/template-editor')
    message.success('任务生成信息已填入模板编辑器')
  }

  const handleRefill = (task: Task) => {
    if (!task.rawTemplate) return
    useGlobalStore.getState().setFillTemplateData(task.rawTemplate)
    if (managementMode) {
      navigate('/', { state: { mobilePanel: 'parameters' } })
    }
    message.success('已重新填入表单')
  }

  const handleRetry = async (task: Task) => {
    await client.api.gptImage.generate.$post({
      json: {
        templateId: task.rawTemplate?.id || '',
        endpointId:
          gptImageSettings.selectedEndpointId || endpoints[0]?.id || '',
        size: (task.size as any) || '2k',
        quality: (task.quality as any) || 'medium',
        originalPrompt: task.originalPrompt,
        writeMetadata: gptImageSettings.writeGenerationMetadata ?? true,
      },
    })
    message.success('已创建重试任务')
  }

  const gptImageTasks = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            task.rawTemplate?.usageType === 'image' ||
            task.rawTemplate?.usageType === 'chat-image',
        )
        .map((task) => ({
          ...task,
          outputUrls: task.outputUrls
            ? task.outputUrls
            : task.outputUrl
              ? [task.outputUrl]
              : [],
        })),
    [tasks],
  )

  const filteredTasks = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase('zh-CN')
    const matchedTasks = keyword
      ? gptImageTasks.filter((task) =>
          [
            task.rawTemplate?.title,
            task.rawTemplate?.prompt,
            task.originalPrompt,
            task.rawTemplate?.folder,
            task.endpointName,
            task.status,
          ].some((value) =>
            String(value || '')
              .toLocaleLowerCase('zh-CN')
              .includes(keyword),
          ),
        )
      : gptImageTasks

    return sortListItems(matchedTasks, sortMode, {
      getTime: (task) => task.createdAt || 0,
      getTitle: (task) =>
        task.rawTemplate?.title || task.rawTemplate?.prompt || '',
    })
  }, [gptImageTasks, searchText, sortMode])

  const reviewImages = useMemo(
    () =>
      managementMode
        ? filteredTasks.flatMap((task) =>
            task.status === 'failed' && task.error
              ? []
              : task.outputUrls.map((src, imageIndex) => ({
                  taskId: task.id,
                  imageIndex,
                  src,
                })),
          )
        : [],
    [filteredTasks, managementMode],
  )
  // Track identity rather than a numeric position: SSE updates may insert tasks.
  const reviewIndex = reviewImage
    ? reviewImages.findIndex(
        (image) =>
          image.taskId === reviewImage.taskId &&
          image.imageIndex === reviewImage.imageIndex &&
          image.src === reviewImage.src,
      )
    : -1

  useEffect(() => {
    if (reviewImage && reviewIndex < 0) setReviewImage(null)
  }, [reviewImage, reviewIndex])

  const showReviewImage = (image: ReviewImage) => {
    setReviewImage(image)
    setReviewedTaskId(image.taskId)
  }

  const scrollToReviewedTask = useCallback(() => {
    if (!reviewedTaskId) return
    taskCardRefs.current.get(reviewedTaskId)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant',
    })
  }, [reviewedTaskId])

  useEffect(() => {
    setPage(0)
    setVisibleCount(pageSize)
  }, [infiniteScroll, pageSize, searchText, sortMode])

  useEffect(() => {
    if (page > 0 && page * pageSize >= filteredTasks.length) setPage(0)
  }, [filteredTasks.length, page, pageSize])

  // 生成新任务后自动聚焦到最新任务（列表顶部，重置分页并滚动定位）
  useEffect(() => {
    if (focusNewestTaskSignal === lastFocusSignalRef.current) return
    lastFocusSignalRef.current = focusNewestTaskSignal
    setPage(0)
    setVisibleCount(pageSize)
    requestAnimationFrame(() => {
      if (panelMode && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }, [focusNewestTaskSignal, pageSize, panelMode])

  const visibleTasks = infiniteScroll
    ? filteredTasks.slice(0, visibleCount)
    : filteredTasks.slice(page * pageSize, page * pageSize + pageSize)
  const hasMoreTasks = infiniteScroll && visibleCount < filteredTasks.length
  const loadMoreTasks = useCallback(() => {
    setVisibleCount((count) => Math.min(count + pageSize, filteredTasks.length))
  }, [filteredTasks.length, pageSize])

  useEffect(() => {
    if (reviewIndex < 0 || !reviewImage) return
    const taskIndex = filteredTasks.findIndex(
      (task) => task.id === reviewImage.taskId,
    )
    if (infiniteScroll) {
      setVisibleCount((count) => Math.max(count, taskIndex + 1))
    } else {
      setPage(Math.floor(taskIndex / pageSize))
    }
    const frame = requestAnimationFrame(scrollToReviewedTask)
    return () => cancelAnimationFrame(frame)
  }, [
    reviewIndex,
    reviewImage,
    filteredTasks,
    infiniteScroll,
    pageSize,
    page,
    visibleCount,
    scrollToReviewedTask,
  ])

  const toggleTaskSelection = (taskId: string) => {
    setSelectedIds((ids) =>
      ids.includes(taskId)
        ? ids.filter((id) => id !== taskId)
        : [...ids, taskId],
    )
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds([])
  }

  const handleBatchDelete = () => {
    if (!selectedIds.length) {
      message.info('请先选择要删除的任务')
      return
    }

    const selectedIdSet = new Set(selectedIds)
    const tasksToDelete = gptImageTasks.filter((task) =>
      selectedIdSet.has(task.id),
    )

    Modal.confirm({
      title: `确认删除选中的 ${tasksToDelete.length} 个任务？`,
      content: gptImageSettings.keepImageWhenDeleteTask
        ? '任务记录会被删除，生成的图片文件将保留。'
        : '任务记录和生成的图片文件都会被永久删除，无法恢复。',
      okText: '批量删除',
      okType: 'danger',
      onOk: async () => {
        setBatchDeleting(true)
        let successCount = 0
        const deletedIds = new Set<string>()
        for (const task of tasksToDelete) {
          try {
            const response = await client.api.task[':id'].$delete({
              param: { id: task.id },
              query: {
                keepImage: gptImageSettings.keepImageWhenDeleteTask
                  ? 'true'
                  : 'false',
              },
            })
            const result = await response.json()
            if (result.success) {
              successCount += 1
              deletedIds.add(task.id)
            }
          } catch {
            // 继续处理剩余任务。
          }
        }
        setBatchDeleting(false)
        setDownloadedIds(
          (downloadedIds || []).filter((id) => !deletedIds.has(id)),
        )
        exitSelectionMode()
        if (successCount === tasksToDelete.length) {
          message.success(`已删除 ${successCount} 个任务`)
        } else {
          message.warning(
            `已删除 ${successCount} 个任务，${tasksToDelete.length - successCount} 个删除失败`,
          )
        }
      },
    })
  }

  const managementActions = managementMode ? (
    selectionMode ? (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <span className="text-xs whitespace-nowrap text-slate-400">
          已选 {selectedIds.length}
        </span>
        <Button
          size="small"
          onClick={() => setSelectedIds(filteredTasks.map((task) => task.id))}
          disabled={!filteredTasks.length}
        >
          全选
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          loading={batchDeleting}
          disabled={!selectedIds.length}
          onClick={handleBatchDelete}
        >
          删除
        </Button>
        <Button size="small" onClick={exitSelectionMode}>
          退出
        </Button>
      </div>
    ) : (
      <Button
        size="small"
        icon={<CheckSquareOutlined />}
        onClick={() => setSelectionMode(true)}
      >
        多选
      </Button>
    )
  ) : undefined

  const taskContent = (
    <>
      <TaskListHeader
        tasks={gptImageTasks}
        downloadedIds={downloadedIds || []}
        setDownloadedIds={setDownloadedIds}
        loading={loading}
        compact={panelMode}
        hideFinishedAlert={managementMode}
        management={managementMode}
      />

      <div className={panelMode ? 'pt-3' : 'mb-2 sm:mb-4'}>
        <ListToolbar
          compact={panelMode}
          fluidSortOnMobile={managementMode}
          searchValue={searchText}
          onSearchChange={setSearchText}
          sortMode={sortMode}
          onSortChange={setSortMode}
          searchPlaceholder="搜索任务标题、提示词或端点"
          actions={managementActions}
        />
      </div>

      <div
        ref={scrollContainerRef}
        className={
          panelMode ? 'min-h-0 flex-1 overflow-y-auto py-3 pr-1' : undefined
        }
      >
        {loading && !gptImageTasks.length ? (
          <div className="flex justify-center py-12">
            <Spin size="large" />
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={searchText ? '没有匹配的任务' : '暂无生成任务'}
            />
          </div>
        ) : (
          <>
            <div
              className={
                panelMode
                  ? 'grid grid-cols-1 gap-2'
                  : managementMode
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-2 sm:gap-4'
                    : 'grid grid-cols-1 gap-4 md:grid-cols-2'
              }
            >
              {visibleTasks.map((task) => {
                const active =
                  task.id === selectedTaskId ||
                  (managementMode && task.id === reviewedTaskId)
                const selected = selectedIds.includes(task.id)
                return (
                  <Card
                    key={task.id}
                    ref={(node) => {
                      if (node) taskCardRefs.current.set(task.id, node)
                      else taskCardRefs.current.delete(task.id)
                    }}
                    size="small"
                    onClick={() =>
                      selectionMode
                        ? toggleTaskSelection(task.id)
                        : onSelectTask?.(task.id)
                    }
                    className={`task-list-card w-full transition-all ${
                      onSelectTask || selectionMode ? 'cursor-pointer' : ''
                    } ${
                      active || selected ? 'task-list-card-active' : 'shadow-sm'
                    }`}
                    classNames={{
                      body: 'task-list-card-body p-[10px]! transition-colors duration-100',
                    }}
                  >
                    {selectionMode && (
                      <div
                        className="mb-2 flex items-center gap-2 text-xs text-slate-400"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selected}
                          onChange={() => toggleTaskSelection(task.id)}
                        />
                        选择任务
                      </div>
                    )}
                    <div
                      className={
                        panelMode
                          ? 'flex gap-3'
                          : managementMode
                            ? 'flex gap-2 sm:gap-4'
                            : 'flex gap-4'
                      }
                    >
                      <div
                        className={`task-list-card-media relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border ${
                          panelMode
                            ? 'h-[120px] w-[90px]'
                            : managementMode
                              ? 'h-[108px] w-[84px] sm:h-[130px] sm:w-[100px]'
                              : 'h-[130px] w-[100px]'
                        }`}
                      >
                        {task.status === 'failed' && task.error ? (
                          <div className="flex w-full flex-col items-center justify-center p-2">
                            <Typography.Text
                              type="danger"
                              strong
                              className="mb-1"
                            >
                              生成失败
                            </Typography.Text>
                            <Typography.Text
                              type="danger"
                              className="w-full cursor-pointer text-center text-xs transition-colors hover:text-red-400!"
                              ellipsis={{ tooltip: task.error }}
                              onClick={() => {
                                if (task.error) {
                                  copy(task.error)
                                  message.success('错误信息已复制')
                                }
                              }}
                            >
                              {task.error}
                            </Typography.Text>
                          </div>
                        ) : task.outputUrls.length === 0 ? (
                          <div className="flex flex-col items-center justify-center p-2">
                            <Typography.Text
                              strong
                              className="mb-1 text-amber-400!"
                            >
                              运行中
                              <SyncOutlined className="ml-1" spin />
                            </Typography.Text>
                          </div>
                        ) : task.outputUrls.length > 1 ? (
                          <div className="flex h-full w-full items-center justify-center">
                            <ImageGroup
                              images={task.outputUrls}
                              width={panelMode ? 90 : 100}
                              height={panelMode ? 120 : 130}
                              preview={!panelMode}
                              onPreview={
                                managementMode
                                  ? (imageIndex) =>
                                      showReviewImage({
                                        taskId: task.id,
                                        imageIndex,
                                        src: task.outputUrls[imageIndex],
                                      })
                                  : undefined
                              }
                            />
                          </div>
                        ) : (
                          <TaskImage
                            src={task.outputUrls[0]}
                            preview={!panelMode}
                            onPreview={
                              managementMode
                                ? () =>
                                    showReviewImage({
                                      taskId: task.id,
                                      imageIndex: 0,
                                      src: task.outputUrls[0],
                                    })
                                : undefined
                            }
                            showSize={
                              gptImageSettings.showImageSizeInTaskList ?? true
                            }
                          />
                        )}
                      </div>

                      <div className="flex min-w-0 grow flex-col justify-between overflow-hidden">
                        <div>
                          <TaskItemTags
                            task={task}
                            downloadedIds={downloadedIds || []}
                            compact={panelMode || managementMode}
                            showEndpoint={!panelMode}
                          />
                          <div className="flex min-w-0 items-center gap-2">
                            {task.rawTemplate?.title && (
                              <Typography.Text
                                strong
                                className="min-w-0 flex-1 truncate"
                                title={task.rawTemplate.title}
                              >
                                {task.rawTemplate.title}
                              </Typography.Text>
                            )}
                            <div className="shrink-0 text-[11px] text-slate-500">
                              {dayjs(task.createdAt).format('YY/MM/DD HH:mm')}
                            </div>
                          </div>
                          {task.rawTemplate?.prompt && (
                            <Typography.Paragraph
                              type="secondary"
                              className="app-accent-hover mb-0! cursor-pointer text-xs transition-colors"
                              ellipsis={{
                                rows: 2,
                                tooltip: {
                                  title: task.rawTemplate.prompt,
                                  placement: 'top',
                                },
                              }}
                              onClick={() => {
                                if (task.rawTemplate?.prompt) {
                                  copy(task.rawTemplate.prompt)
                                  message.success('提示词已复制')
                                }
                              }}
                            >
                              {task.rawTemplate.prompt}
                            </Typography.Paragraph>
                          )}
                        </div>

                        {!selectionMode && (
                          <div
                            className={`flex min-w-0 items-center ${
                              panelMode
                                ? 'justify-between gap-2'
                                : 'justify-end'
                            }`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {panelMode && (
                              <Tooltip
                                title={task.endpointName || '未记录端点'}
                              >
                                <div className="flex min-w-0 items-center gap-1 text-[11px] text-violet-300/80">
                                  <GlobalOutlined className="shrink-0" />
                                  <span className="truncate">
                                    {task.endpointName || '未知端点'}
                                  </span>
                                </div>
                              </Tooltip>
                            )}
                            <div className="flex items-center gap-0.5">
                              {task.originalPrompt !== undefined && (
                                <Tooltip title="查看优化前的提示词">
                                  <Button
                                    type="text"
                                    icon={<BulbOutlined />}
                                    onClick={() =>
                                      setOriginalPromptView({
                                        text: task.originalPrompt || '',
                                      })
                                    }
                                    aria-label="查看优化前的提示词"
                                    className="text-amber-300!"
                                  />
                                </Tooltip>
                              )}
                              {managementMode && task.rawTemplate && (
                                <Tooltip title="添加到模板">
                                  <Button
                                    type="primary"
                                    size="small"
                                    icon={<FileAddOutlined />}
                                    onClick={() => handleAddToTemplate(task)}
                                    aria-label="添加到模板"
                                    className="px-2! sm:px-3!"
                                  >
                                    <span className="hidden sm:inline">
                                      添加到模板
                                    </span>
                                  </Button>
                                </Tooltip>
                              )}
                              {task.rawTemplate && (
                                <Tooltip title="重新填入">
                                  <Button
                                    type="text"
                                    icon={<VerticalAlignTopOutlined />}
                                    onClick={() => handleRefill(task)}
                                    aria-label="重新填入"
                                  />
                                </Tooltip>
                              )}
                              {task.outputUrls.length > 0 && (
                                <TaskItemDownloadButton
                                  outputUrls={task.outputUrls}
                                  fileName={
                                    task.rawTemplate?.title ||
                                    task.rawTemplate?.prompt ||
                                    `task_${task.id}`
                                  }
                                  endpointName={task.endpointName}
                                  createdAt={task.createdAt}
                                  onDownloaded={() => {
                                    if (!downloadedIds?.includes(task.id)) {
                                      setDownloadedIds([
                                        ...(downloadedIds || []),
                                        task.id,
                                      ])
                                    }
                                  }}
                                />
                              )}
                              {task.rawTemplate?.title !==
                                TRIAL_TEMPLATE_TITLE && (
                                <Tooltip title="重试">
                                  <Button
                                    type="text"
                                    icon={<RedoOutlined />}
                                    onClick={() => handleRetry(task)}
                                  />
                                </Tooltip>
                              )}
                              <TaskItemDeleteButton
                                id={task.id}
                                status={task.status}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>

            {hasMoreTasks ? (
              <InfiniteScrollSentinel
                hasMore={hasMoreTasks}
                onLoadMore={loadMoreTasks}
              />
            ) : (
              !infiniteScroll &&
              filteredTasks.length > pageSize && (
                <div className="mt-4 flex justify-center">
                  <Pagination
                    current={page + 1}
                    pageSize={pageSize}
                    showSizeChanger={false}
                    simple={panelMode}
                    total={filteredTasks.length}
                    onChange={(nextPage) => setPage(nextPage - 1)}
                  />
                </div>
              )
            )}
          </>
        )}
      </div>
      <Modal
        title="优化前的提示词"
        open={originalPromptView !== null}
        onCancel={() => setOriginalPromptView(null)}
        width={620}
        destroyOnHidden
        footer={[
          <Button
            key="copy"
            disabled={!originalPromptView?.text}
            onClick={() => {
              if (!originalPromptView?.text) return
              copy(originalPromptView.text)
              message.success('优化前的提示词已复制')
            }}
          >
            复制
          </Button>,
          <Button
            key="close"
            type="primary"
            onClick={() => setOriginalPromptView(null)}
          >
            关闭
          </Button>,
        ]}
      >
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-slate-700 bg-slate-950/40 p-3 text-sm break-words whitespace-pre-wrap text-slate-200">
          {originalPromptView?.text || '（优化前未填写文字提示词）'}
        </div>
      </Modal>
    </>
  )

  if (panelMode) {
    return (
      <div className="flex h-full min-h-0 flex-col px-3">{taskContent}</div>
    )
  }

  return (
    <Card
      className={
        managementMode
          ? 'task-list-management-shell w-full shadow-none! sm:shadow-sm'
          : 'w-full border-[#303640] shadow-sm'
      }
      classNames={{
        body: managementMode ? 'p-0! sm:px-3! md:px-6!' : 'px-3! md:px-6!',
      }}
      styles={{ body: { paddingTop: 0 } }}
    >
      {taskContent}
      {managementMode && (
        <TaskReviewPreview
          images={reviewImages}
          current={reviewIndex}
          onChange={(index) => {
            const image = reviewImages[index]
            if (image) showReviewImage(image)
          }}
          onClose={() => setReviewImage(null)}
          onAfterClose={scrollToReviewedTask}
        />
      )}
    </Card>
  )
}
