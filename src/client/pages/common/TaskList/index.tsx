import {
  BulbOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  FolderOutlined,
  GlobalOutlined,
  RedoOutlined,
  SyncOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLocalStorageState } from 'ahooks'
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Select,
  Spin,
  Tooltip,
  Typography,
  message,
  theme,
} from 'antd'
import copy from 'copy-to-clipboard'
import dayjs from 'dayjs'
import { hc } from 'hono/client'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppType } from '../../../../server'
import type { Task } from '../../../../server/common/task-manager'
import { taskListActions, type TaskListActions } from '../../../../shared/task-list'
import {
  taskFolderNameSchema,
  type TaskFolder,
} from '../../../../shared/task-folders'
import {
  resolveImageEndpointId,
  useEnabledImageEndpoints,
} from '../../../hooks/useEnabledImageEndpoints'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { usePlatform } from '../../../hooks/usePlatform'
import { loadTask, useTasks, useTaskDetails } from '../../../hooks/useTasks'
import { t, useAppLanguage } from '../../../i18n'
import { ImageGroup } from '../../../pages/common/components/ImageGroup'
import { useGlobalStore } from '../../../store/global'
import { localImageVariant } from '../../../utils/imageUrls'
import {
  ListToolbar,
  sortListItems,
  type ListSortMode,
} from '../components/ListToolbar'
import { ThumbnailImage } from '../components/ThumbnailImage'
import { generateNovelAIStudioImages } from '../Studio/api'
import { CopyToStudioButton } from '../Studio/CopyToStudioButton'
import { VideoTaskCard } from '../Studio/VideoTaskCard'
import { TaskFolderCard } from './components/TaskFolderCard'
import { TaskItemDeleteButton } from './components/TaskItemDeleteButton'
import { TaskItemDownloadButton } from './components/TaskItemDownloadButton'
import { TaskItemMetrics, TaskItemTags } from './components/TaskItemTags'
import { TaskListDownloadButton } from './components/TaskListDownloadButton'
import {
  TaskReviewPreview,
  type ReviewImage,
} from './components/TaskReviewPreview'
import { TaskListHeader } from './TaskListHeader'

const client = hc<AppType>('/')

interface TaskListProps {
  variant?: 'default' | 'panel' | 'management'
  active?: boolean
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

function findScrollContainer(element: HTMLElement): HTMLElement {
  let parent = element.parentElement
  while (parent) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent
    parent = parent.parentElement
  }
  return document.scrollingElement as HTMLElement
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
  useAppLanguage()

  const [info, setInfo] = useState<{
    src: string
    width?: number
    height?: number
    bytes?: number
  } | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const metadataUrl = localImageVariant(src, 'metadata')
  const currentInfo = info?.src === src ? info : null

  const handleLoaded = useCallback(
    (image: HTMLImageElement) => {
      setLoadedSrc(src)
      // External images have no local metadata endpoint. Never label thumbnail
      // dimensions as the original dimensions.
      if (!metadataUrl && image.naturalWidth && image.naturalHeight)
        setInfo({ src, width: image.naturalWidth, height: image.naturalHeight })
    },
    [src, metadataUrl],
  )

  useEffect(() => {
    if (!showSize || loadedSrc !== src || !metadataUrl) return

    const controller = new AbortController()
    fetch(metadataUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return response.json()
      })
      .then((metadata) => {
        if (!controller.signal.aborted) setInfo({ ...metadata, src })
      })
      .catch(() => {})

    return () => controller.abort()
  }, [loadedSrc, showSize, src, metadataUrl])

  return (
    <>
      <div className="contents">
        <ThumbnailImage
          src={src}
          alt="result"
          preview={onPreview || !preview ? false : { src }}
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
      {showSize && currentInfo && (
        <div className="pointer-events-none absolute top-0 left-0 z-10 rounded-br bg-black/55 px-1 text-[10px] leading-4 text-white">
          {currentInfo.width && currentInfo.height
            ? `${currentInfo.width}×${currentInfo.height}`
            : ''}
          {currentInfo.bytes !== undefined &&
            `${currentInfo.width && currentInfo.height ? ' · ' : ''}${formatFileSize(currentInfo.bytes)}`}
        </div>
      )}
    </>
  )
}

export function TaskList({
  variant = 'default',
  active = true,
  selectedTaskId,
  onSelectTask,
}: TaskListProps) {
  const { language } = useAppLanguage()
  const { token } = theme.useToken()

  const panelMode = variant === 'panel'
  const managementMode = variant === 'management'
  const { isMobile } = usePlatform()
  const navigate = useNavigate()
  const { data: tasks = [], folders, loading, revision, error: catalogError, refresh: refreshCatalog } = useTasks()
  const folderId = useGlobalStore((state) => state.taskFolderId)
  const setFolderId = useGlobalStore((state) => state.setTaskFolderId)
  const currentFolder = folders.find((folder) => folder.id === folderId)
  const [folderEditor, setFolderEditor] = useState<{
    folder?: TaskFolder
  } | null>(null)
  const [folderName, setFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveFolderId, setMoveFolderId] = useState('')
  const [moving, setMoving] = useState(false)
  const { gptImageSettings } = useLocalSetting()
  const endpoints = useEnabledImageEndpoints()
  const [downloadedIds, setDownloadedIds] = useLocalStorageState<string[]>(
    'downloadedTaskIds',
    { defaultValue: [] },
  )
  const [, setSkipDeleteConfirm] = useLocalStorageState<boolean>(
    'skipDeleteTaskConfirm',
    { defaultValue: false },
  )
  const [page, setPage] = useState(0)
  const infiniteScroll = panelMode
    ? (gptImageSettings.workspaceListInfiniteScroll ?? true)
    : (gptImageSettings.taskManagerInfiniteScroll ?? true)
  const pageSize = panelMode
    ? (gptImageSettings.workspaceListPageSize ?? 8)
    : (gptImageSettings.taskManagerPageSize ?? 12)
  const [searchText, setSearchText] = useState('')
  const [sortMode, setSortMode] = useState<ListSortMode>('default')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [retryingTaskId, setRetryingTaskId] = useState<string>()
  const pendingActions = useRef(new Set<string>())
  const [loadingActions, setLoadingActions] = useState(
    new Map<string, keyof TaskListActions>(),
  )
  const [reviewImage, setReviewImage] = useState<ReviewImage | null>(null)
  const [reviewedTaskId, setReviewedTaskId] = useState<string | null>(null)
  const [reviewOrphaned, setReviewOrphaned] = useState(false)
  const [reviewDeleting, setReviewDeleting] = useState(false)
  const [reviewDeleteChoice, setReviewDeleteChoice] =
    useState<ReviewImage | null>(null)
  const [originalPromptView, setOriginalPromptView] = useState<{
    text: string
  } | null>(null)
  const taskCardRefs = useRef(new Map<string, HTMLDivElement>())
  const virtualListRef = useRef<HTMLDivElement>(null)
  const [virtualScrollElement, setVirtualScrollElement] =
    useState<HTMLElement | null>(null)
  const [listWidth, setListWidth] = useState(0)
  const [spaciousLayout, setSpaciousLayout] = useState(false)
  const [wideLayout, setWideLayout] = useState(false)
  const [desktopWorkbench, setDesktopWorkbench] = useState(false)
  const [scrollMargin, setScrollMargin] = useState(0)
  const lastReviewIndexRef = useRef(0)
  const focusNewestTaskSignal = useGlobalStore(
    (state) => state.focusNewestTaskSignal,
  )
  const lastFocusSignalRef = useRef(focusNewestTaskSignal)

  const runTaskAction = async (
    summary: Task,
    action: keyof TaskListActions,
    run: (task: Task) => void | Promise<void>,
  ) => {
    if (pendingActions.current.has(summary.id)) return
    pendingActions.current.add(summary.id)
    setLoadingActions((current) => new Map(current).set(summary.id, action))
    try {
      // Catalog records intentionally omit reference images and provider snapshots.
      const task = summary.summaryOnly ? await loadTask(summary.id) : summary
      if (!taskListActions(task)[action]) return
      await run(task)
    } catch (error) {
      message.error(error instanceof Error ? t(error.message) : t('请求失败'))
    } finally {
      pendingActions.current.delete(summary.id)
      setLoadingActions((current) => {
        const next = new Map(current)
        next.delete(summary.id)
        return next
      })
    }
  }

  const handleAddToTemplate = (task: Task) => {
    if (!task.rawTemplate) return
    useGlobalStore.getState().setFillTemplateData(task.rawTemplate)
    navigate('/template-editor')
    message.success(t('任务生成信息已填入模板编辑器'))
  }

  const handleRefill = (task: Task) => {
    const novelai = task.novelaiSnapshots?.[0] || task.studioProvenance?.novelai
    if (novelai) {
      navigate('/studio', { state: { novelaiRequest: novelai.request } })
      message.success(t('已回填 NovelAI 工作室参数'))
      return
    }
    if (!task.rawTemplate) return
    useGlobalStore.getState().setFillTemplateData(task.rawTemplate)
    if (managementMode) {
      navigate('/', { state: { mobilePanel: 'parameters' } })
    }
    message.success(t('已重新填入表单'))
  }

  const handleRetry = async (task: Task) => {
    const novelai = task.novelaiSnapshots?.[0] || task.studioProvenance?.novelai
    if (novelai) {
      setRetryingTaskId(task.id)
      try {
        const result = await generateNovelAIStudioImages({
          ...novelai.request,
          saveToTaskList: true,
          folderId: task.folderId,
        })
        window.dispatchEvent(new Event('studio-changed'))
        message.success(t('已重新生成 {0} 张图片', [result.items.length]))
      } catch (error) {
        message.error(
          error instanceof Error ? t(error.message) : t('NovelAI 重试失败'),
        )
      } finally {
        setRetryingTaskId(undefined)
      }
      return
    }
    const endpointId = resolveImageEndpointId(
      endpoints,
      task.rawTemplate?.endpointId || gptImageSettings.selectedEndpointId,
      gptImageSettings.defaultEndpointId,
    )
    if (!endpointId) {
      message.warning(t('无可用端点，请到设置中添加或启用'))
      return
    }
    const res = await client.api.gptImage.trial.$post({
      json: {
        prompt: task.rawTemplate.prompt,
        title: task.rawTemplate.title,
        images: task.rawTemplate.images,
        aspectRatio: task.rawTemplate.aspectRatio,
        injectAspectRatio: task.rawTemplate.injectAspectRatio,
        gpt2QualityOptimization: task.rawTemplate.gpt2QualityOptimization,
        n: task.rawTemplate.n,
        endpointId,
        size: (task.size as any) || '2k',
        quality: (task.quality as any) || 'medium',
        language,
        originalPrompt: task.originalPrompt,
        folderId: task.folderId,
        writeMetadata: gptImageSettings.writeGenerationMetadata ?? true,
      },
    })
    const result = await res.json()
    if (!result.success) {
      message.error(t(result.error || '') || t('生成失败'))
      return
    }
    message.success(t('已创建重试任务'))
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

  const searchedTasks = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase('zh-CN')
    const matchedTasks = keyword
      ? gptImageTasks.filter((task) =>
          [
            task.rawTemplate?.title,
            task.rawTemplate?.prompt,
            task.originalPrompt,
            task.rawTemplate?.folder,
            folders.find((folder) => folder.id === task.folderId)?.name,
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
  }, [gptImageTasks, searchText, sortMode, folders])

  const filteredTasks = useMemo(
    () =>
      searchedTasks.filter((task) =>
        folderId
          ? task.folderId === folderId
          : !folders.some((folder) => folder.id === task.folderId),
      ),
    [searchedTasks, folderId, folders],
  )
  useLayoutEffect(() => {
    if (!active || !infiniteScroll || !filteredTasks.length) return
    const list = virtualListRef.current
    if (!list) return
    // On narrow workbenches the panel grows with its content; the outer page
    // scrolls. Treating the panel as the viewport mounts the entire history.
    const scrollRoot =
      panelMode && !window.matchMedia('(min-width: 1024px)').matches
        ? list.closest<HTMLElement>('.workbench-panel') ?? list
        : list
    const scrollElement = findScrollContainer(scrollRoot)
    setVirtualScrollElement(scrollElement)
    const measure = () => {
      setListWidth(list.clientWidth)
      setSpaciousLayout(window.matchMedia('(min-width: 640px)').matches)
      setWideLayout(window.matchMedia('(min-width: 768px)').matches)
      setDesktopWorkbench(window.matchMedia('(min-width: 1024px)').matches)
      setScrollMargin(
        scrollElement.scrollTop +
          list.getBoundingClientRect().top -
          scrollElement.getBoundingClientRect().top,
      )
    }
    measure()
    let measureFrame: number | undefined
    const scheduleMeasure = () => {
      if (measureFrame !== undefined) return
      measureFrame = requestAnimationFrame(() => {
        measureFrame = undefined
        measure()
      })
    }
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(scrollElement)
    // Hidden mobile panels start at width zero. Remeasure when they are shown,
    // while ignoring virtual-list height changes to avoid measurement loops.
    let measuredWidth = list.clientWidth
    const listObserver = new ResizeObserver(() => {
      if (list.clientWidth === measuredWidth) return
      measuredWidth = list.clientWidth
      scheduleMeasure()
    })
    listObserver.observe(list)
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      observer.disconnect()
      listObserver.disconnect()
      if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [
    active,
    infiniteScroll,
    filteredTasks.length,
    panelMode,
    folders.length,
    folderId,
    searchText,
    spaciousLayout,
    wideLayout,
    desktopWorkbench,
  ])

  const columnCount = panelMode
    ? 1
    : managementMode
      ? Math.max(
          1,
          Math.floor(
            (listWidth + (spaciousLayout ? 16 : 8)) /
              (360 + (spaciousLayout ? 16 : 8)),
          ),
        )
      : wideLayout
        ? 2
        : 1
  const rowCount = Math.ceil(filteredTasks.length / columnCount)
  const rowGap = panelMode ? 8 : managementMode ? (spaciousLayout ? 16 : 8) : 16
  const virtualOptions = {
    count: rowCount,
    estimateSize: () => (panelMode ? 168 : isMobile ? 200 : 170),
    gap: rowGap,
    overscan: 3,
    useAnimationFrameWithResizeObserver: true,
    getItemKey: (index: number) =>
      filteredTasks[index * columnCount]?.id ?? index,
    scrollMargin,
  }
  const taskVirtualizer = useVirtualizer({
    ...virtualOptions,
    getScrollElement: () => virtualScrollElement,
    enabled: active && infiniteScroll && Boolean(virtualScrollElement),
  })
  const visibleFolders = folderId
    ? []
    : folders
        .filter(
          (folder) =>
            !searchText.trim() ||
            folder.name
              .toLocaleLowerCase()
              .includes(searchText.trim().toLocaleLowerCase()) ||
            searchedTasks.some((task) => task.folderId === folder.id),
        )
        .sort((a, b) => a.name.localeCompare(b.name))

  const handleMove = async (ids: string[], targetFolderId: string) => {
    setMoving(true)
    try {
      const response = await client.api.task.move.$put({
        json: { ids, folderId: targetFolderId },
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error)
      message.success(targetFolderId ? t('已移动到文件夹') : t('已移出文件夹'))
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
      setMoveOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? t(error.message) : t('移动失败'))
    } finally {
      setMoving(false)
    }
  }

  const saveFolder = async () => {
    const parsed = taskFolderNameSchema.safeParse(folderName)
    if (!parsed.success) {
      message.warning(t('文件夹名称无效'))
      return
    }
    setSavingFolder(true)
    try {
      const response = folderEditor?.folder
        ? await client.api.task.folders[':id'].$put({
            param: { id: folderEditor.folder.id },
            json: { name: parsed.data },
          })
        : await client.api.task.folders.$post({ json: { name: parsed.data } })
      const result = await response.json()
      if (!result.success) throw new Error(result.error)
      setFolderEditor(null)
      message.success(t('文件夹已保存'))
    } catch (error) {
      message.error(error instanceof Error ? t(error.message) : t('保存失败'))
    } finally {
      setSavingFolder(false)
    }
  }

  const deleteFolder = (folder: TaskFolder) => {
    Modal.confirm({
      title: t('删除文件夹“{0}”？', [folder.name]),
      content: t('里面的任务将移回主文件夹，图片会保留。'),
      okText: t('删除文件夹'),
      cancelText: t('取消'),
      onOk: async () => {
        try {
          const response = await client.api.task.folders[':id'].$delete({
            param: { id: folder.id },
          })
          const result = await response.json()
          if (!result.success) throw new Error(result.error)
          message.success(t('文件夹已删除'))
        } catch (error) {
          message.error(
            error instanceof Error ? t(error.message) : t('删除失败'),
          )
        }
      },
    })
  }

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
  const presentedReviewImages =
    reviewOrphaned && reviewImage && reviewIndex < 0
      ? [reviewImage]
      : reviewImages
  const presentedReviewIndex =
    reviewOrphaned && reviewImage && reviewIndex < 0 ? 0 : reviewIndex

  useEffect(() => {
    if (reviewIndex >= 0) lastReviewIndexRef.current = reviewIndex
  }, [reviewIndex])

  useEffect(() => {
    if (!reviewImage || reviewIndex >= 0) return
    if (reviewOrphaned && !reviewImages.length) return

    // Removing an earlier image changes later indices. Follow the image by
    // stable task/source identity before falling back to a neighbouring item.
    const relocatedImage = reviewImages.find(
      (image) =>
        image.taskId === reviewImage.taskId && image.src === reviewImage.src,
    )
    const fallbackImage =
      relocatedImage ||
      reviewImages[
        Math.min(lastReviewIndexRef.current, reviewImages.length - 1)
      ]
    if (fallbackImage) {
      setReviewOrphaned(false)
      setReviewImage(fallbackImage)
      setReviewedTaskId(fallbackImage.taskId)
    } else {
      setReviewImage(null)
    }
  }, [reviewImage, reviewImages, reviewIndex, reviewOrphaned])

  const reviewDetails = useTaskDetails(reviewImage ? [reviewImage.taskId] : [], revision)
  const currentReviewTask = reviewImage ? reviewDetails.data.get(reviewImage.taskId) : undefined
  const canAddCurrentReviewToTemplate = Boolean(
    currentReviewTask?.rawTemplate &&
    (!currentReviewTask.studioProvenance ||
      currentReviewTask.studioProvenance.template),
  )

  const showReviewImage = (image: ReviewImage) => {
    setReviewOrphaned(false)
    setReviewImage(image)
    setReviewedTaskId(image.taskId)
  }

  const scrollToReviewedTask = useCallback(() => {
    if (!reviewedTaskId) return
    const taskIndex = filteredTasks.findIndex(
      (task) => task.id === reviewedTaskId,
    )
    if (taskIndex < 0) return
    if (infiniteScroll)
      taskVirtualizer.scrollToIndex(Math.floor(taskIndex / columnCount))
    requestAnimationFrame(() => {
      taskCardRefs.current.get(reviewedTaskId)?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'instant',
      })
    })
  }, [
    reviewedTaskId,
    filteredTasks,
    infiniteScroll,
    taskVirtualizer,
    columnCount,
  ])

  useEffect(() => {
    setPage(0)
  }, [infiniteScroll, pageSize, searchText, sortMode, folderId])

  useEffect(() => {
    setSelectedIds([])
    setReviewImage(null)
    setReviewedTaskId(null)
    setReviewOrphaned(false)
    setMoveOpen(false)
  }, [folderId])

  useEffect(() => {
    if (page > 0 && page * pageSize >= filteredTasks.length) setPage(0)
  }, [filteredTasks.length, page, pageSize])

  // 仅桌面工作台的独立任务栏自动定位；移动端共用页面滚动容器，
  // 隐藏的任务栏也保持挂载，不能因生成信号打断参数或任务列表的浏览。
  useEffect(() => {
    if (focusNewestTaskSignal === lastFocusSignalRef.current) return
    lastFocusSignalRef.current = focusNewestTaskSignal
    if (!panelMode || !window.matchMedia('(min-width: 1024px)').matches) return
    setPage(0)
    if (
      !virtualScrollElement ||
      virtualScrollElement.matches('[data-mobile-scroll-root]') ||
      virtualScrollElement === document.scrollingElement
    ) {
      return
    }
    const frame = requestAnimationFrame(() => {
      virtualScrollElement?.scrollTo({ top: 0, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusNewestTaskSignal, panelMode, virtualScrollElement])

  const visibleTasks = filteredTasks.slice(
    page * pageSize,
    page * pageSize + pageSize,
  )
  const renderedRows = infiniteScroll
    ? taskVirtualizer.getVirtualItems().map((row) => ({
        key: row.key,
        index: row.index,
        start: row.start,
        tasks: filteredTasks.slice(
          row.index * columnCount,
          (row.index + 1) * columnCount,
        ),
      }))
    : [{ key: 'page', index: 0, start: 0, tasks: visibleTasks }]

  useEffect(() => {
    if (reviewIndex < 0 || !reviewImage) return
    const taskIndex = filteredTasks.findIndex(
      (task) => task.id === reviewImage.taskId,
    )
    if (!infiniteScroll) setPage(Math.floor(taskIndex / pageSize))
    const frame = requestAnimationFrame(scrollToReviewedTask)
    return () => cancelAnimationFrame(frame)
  }, [
    reviewIndex,
    reviewImage,
    filteredTasks,
    infiniteScroll,
    pageSize,
    page,
    scrollToReviewedTask,
  ])

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedIds((ids) =>
      ids.includes(taskId)
        ? ids.filter((id) => id !== taskId)
        : [...ids, taskId],
    )
  }, [])

  const toggleReviewedTaskSelection = useCallback(() => {
    if (!reviewImage) return
    if (!selectionMode) setSelectionMode(true)
    toggleTaskSelection(reviewImage.taskId)
  }, [reviewImage, selectionMode, toggleTaskSelection])

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds([])
  }

  const moveReviewToRemainingImage = useCallback(
    (shouldRemove: (image: ReviewImage) => boolean) => {
      const remainingImages = reviewImages.filter(
        (image) => !shouldRemove(image),
      )
      if (!remainingImages.length) {
        setReviewOrphaned(true)
        return
      }

      setReviewOrphaned(false)
      const nextImage =
        remainingImages[
          Math.min(Math.max(reviewIndex, 0), remainingImages.length - 1)
        ]
      setReviewImage(nextImage)
      setReviewedTaskId(nextImage.taskId)
    },
    [reviewImages, reviewIndex],
  )

  const deleteReviewedTask = useCallback(
    async (target: ReviewImage) => {
      const task = gptImageTasks.find((item) => item.id === target.taskId)
      if (!task) {
        message.error(t('当前任务已不存在'))
        return false
      }

      setReviewDeleting(true)
      moveReviewToRemainingImage((image) => image.taskId === target.taskId)
      try {
        const response = await client.api.task[':id'].$delete({
          param: { id: target.taskId },
          query: {
            keepImage: gptImageSettings.keepImageWhenDeleteTask
              ? 'true'
              : 'false',
          },
        })
        const result = await response.json()
        if (!result.success) {
          throw new Error(t(result.error || '') || t('删除失败'))
        }
        setDownloadedIds(
          (downloadedIds || []).filter((id) => id !== target.taskId),
        )
        message.success(t('任务已删除'))
        return true
      } catch (error: any) {
        setReviewOrphaned(false)
        setReviewImage(target)
        setReviewedTaskId(target.taskId)
        message.error(t(error.message) || t('删除失败'))
        return false
      } finally {
        setReviewDeleting(false)
      }
    },
    [
      downloadedIds,
      gptImageSettings.keepImageWhenDeleteTask,
      gptImageTasks,
      moveReviewToRemainingImage,
      setDownloadedIds,
    ],
  )

  const deleteReviewedImage = useCallback(
    async (target: ReviewImage) => {
      const task = gptImageTasks.find((item) => item.id === target.taskId)
      const currentImageIndex =
        task?.outputUrls[target.imageIndex] === target.src
          ? target.imageIndex
          : task?.outputUrls.findIndex((url) => url === target.src)
      if (!task || currentImageIndex === undefined || currentImageIndex < 0) {
        message.error(t('当前图片已不存在'))
        return false
      }

      setReviewDeleting(true)
      moveReviewToRemainingImage(
        (image) =>
          image.taskId === target.taskId &&
          image.imageIndex === target.imageIndex &&
          image.src === target.src,
      )
      try {
        const response = await client.api.task[':id'].images[':index'].$delete({
          param: { id: target.taskId, index: String(currentImageIndex) },
        })
        const result = await response.json()
        if (!result.success) {
          throw new Error(t(result.error || '') || t('删除图片失败'))
        }
        setDownloadedIds(
          (downloadedIds || []).filter((id) => id !== target.taskId),
        )
        message.success(t('图片已删除'))
        return true
      } catch (error: any) {
        setReviewOrphaned(false)
        setReviewImage(target)
        setReviewedTaskId(target.taskId)
        message.error(t(error.message) || t('删除图片失败'))
        return false
      } finally {
        setReviewDeleting(false)
      }
    },
    [
      downloadedIds,
      gptImageTasks,
      moveReviewToRemainingImage,
      setDownloadedIds,
    ],
  )

  const confirmDeleteReviewedTask = useCallback(
    (target: ReviewImage) => {
      const task = gptImageTasks.find((item) => item.id === target.taskId)
      if (!task) {
        message.error(t('当前任务已不存在'))
        return
      }

      let skip = false
      try {
        const raw = localStorage.getItem('skipDeleteTaskConfirm')
        skip = raw !== null && JSON.parse(raw) === true
      } catch {
        skip = false
      }
      if (skip || task.status === 'failed') {
        void deleteReviewedTask(target)
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
              onChange={(event) => {
                skipNext = event.target.checked
              }}
            >
              {t('下次不再提醒')}
            </Checkbox>
          </div>
        ),
        okText: t('确认删除'),
        okType: 'danger',
        onOk: async () => {
          if (skipNext) setSkipDeleteConfirm(true)
          await deleteReviewedTask(target)
        },
      })
    },
    [
      deleteReviewedTask,
      gptImageSettings.keepImageWhenDeleteTask,
      gptImageTasks,
      setSkipDeleteConfirm,
    ],
  )

  const handleDeleteReviewedItem = useCallback(() => {
    if (!reviewImage || !currentReviewTask || selectionMode) return
    if (currentReviewTask.outputUrls.length > 1) {
      setReviewDeleteChoice(reviewImage)
      return
    }
    confirmDeleteReviewedTask(reviewImage)
  }, [confirmDeleteReviewedTask, currentReviewTask, reviewImage, selectionMode])

  const handleBatchDelete = () => {
    if (!selectedIds.length) {
      message.info(t('请先选择要删除的任务'))
      return
    }

    const selectedIdSet = new Set(selectedIds)
    const tasksToDelete = gptImageTasks.filter((task) =>
      selectedIdSet.has(task.id),
    )

    Modal.confirm({
      title: t('确认删除选中的 {0} 个任务？', [tasksToDelete.length]),
      content: gptImageSettings.keepImageWhenDeleteTask
        ? t('任务记录会被删除，生成的图片和本地视频文件将保留；没有记录的视频只能从存储目录手动访问。')
        : t('任务记录、生成的图片和本地视频文件都会被永久删除，无法恢复。云端视频任务不会被取消。'),
      okText: t('批量删除'),
      okType: 'danger',
      onOk: async () => {
        setBatchDeleting(true)
        try {
          const response = await client.api.task.batch.$delete({
            json: {
              ids: tasksToDelete.map((task) => task.id),
              keepImage: Boolean(gptImageSettings.keepImageWhenDeleteTask),
            },
          })
          const result = await response.json()
          if (!result.success) throw new Error(result.error)
          const deletedIds = new Set(tasksToDelete.map((task) => task.id))
          setDownloadedIds(
            (downloadedIds || []).filter((id) => !deletedIds.has(id)),
          )
          exitSelectionMode()
          message.success(t('已删除 {0} 个任务', [result.count]))
        } catch (error) {
          message.error(
            error instanceof Error ? t(error.message) : t('删除失败'),
          )
        } finally {
          setBatchDeleting(false)
        }
      },
    })
  }

  const managementActions = managementMode ? (
    selectionMode ? (
      <div className="task-list-selection-toolbar">
        <div className="task-list-selection-status">
          <span className="text-xs text-slate-500">
            {t('已选')} {selectedIds.length}
          </span>
          <Button size="small" onClick={exitSelectionMode}>
            {t('退出')}
          </Button>
        </div>
        <div className="task-list-selection-actions">
          <Button
            size="small"
            onClick={() => setSelectedIds(filteredTasks.map((task) => task.id))}
            disabled={!filteredTasks.length}
          >
            {t('全选')}
          </Button>
          <Button
            size="small"
            disabled={!filteredTasks.length}
            onClick={() => {
              const scope = new Set(filteredTasks.map((task) => task.id))
              setSelectedIds((ids) => [
                ...ids.filter((id) => !scope.has(id)),
                ...filteredTasks
                  .filter((task) => !ids.includes(task.id))
                  .map((task) => task.id),
              ])
            }}
          >
            {t('反选')}
          </Button>
          <Button
            size="small"
            icon={<FolderOutlined />}
            loading={moving}
            disabled={!selectedIds.length || batchDeleting}
            onClick={() => {
              setMoveFolderId(folderId)
              setMoveOpen(true)
            }}
          >
            {t('移动到文件夹')}
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={batchDeleting}
            disabled={!selectedIds.length}
            onClick={handleBatchDelete}
          >
            {t('删除')}
          </Button>
        </div>
      </div>
    ) : (
      <Button
        size="small"
        icon={<CheckSquareOutlined />}
        onClick={() => setSelectionMode(true)}
      >
        {t('多选')}
      </Button>
    )
  ) : undefined

  const taskContent = (
    <>
      <TaskListHeader
        tasks={gptImageTasks}
        folders={folders}
        downloadedIds={downloadedIds || []}
        setDownloadedIds={setDownloadedIds}
        loading={loading}
        compact={panelMode}
        hideFinishedAlert={managementMode}
        management={managementMode}
      />

      <div
        className={`task-list-folder-toolbar ${currentFolder ? 'task-list-folder-toolbar-with-download' : ''}`}
      >
        <span
          className="task-list-folder-name min-w-0 text-sm"
          title={currentFolder?.name}
        >
          <span className="min-w-0 truncate">
            {currentFolder?.name || t('主文件夹')}
          </span>
          <span className="text-xs text-slate-500">{filteredTasks.length}</span>
        </span>
        <div className="task-list-folder-actions">
          {currentFolder && (
            <TaskListDownloadButton
              tasks={gptImageTasks.filter((task) => task.folderId === folderId)}
              folders={folders}
              folder={currentFolder}
              downloadedIds={downloadedIds || []}
              setDownloadedIds={setDownloadedIds}
              includeDownloaded
            />
          )}
          <Button
            size="small"
            icon={<FolderAddOutlined />}
            onClick={() => {
              setFolderName('')
              setFolderEditor({})
            }}
          >
            {t('新建文件夹')}
          </Button>
        </div>
      </div>

      <div className={panelMode ? 'pt-3' : 'mb-2 sm:mb-4'}>
        <ListToolbar
          compact={panelMode}
          fluidSortOnMobile={managementMode}
          searchValue={searchText}
          onSearchChange={setSearchText}
          sortMode={sortMode}
          onSortChange={setSortMode}
          searchPlaceholder={t('搜索任务标题、提示词或端点')}
          actions={selectionMode ? undefined : managementActions}
        />
        {selectionMode && managementActions}
      </div>

      <div
        className={
          panelMode ? 'min-h-0 flex-1 overflow-y-auto py-3 pr-1' : undefined
        }
      >
        {(currentFolder || visibleFolders.length > 0) && (
          <div
            className={
              panelMode
                ? 'mb-3 grid grid-cols-1 gap-2'
                : 'mb-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-2'
            }
          >
            {currentFolder && (
              <TaskFolderCard
                tasks={[]}
                folders={folders}
                downloadedIds={downloadedIds || []}
                setDownloadedIds={setDownloadedIds}
                onOpen={() => setFolderId('')}
                onMove={handleMove}
              />
            )}
            {visibleFolders.map((folder) => (
              <TaskFolderCard
                key={folder.id}
                folder={folder}
                tasks={gptImageTasks.filter(
                  (task) => task.folderId === folder.id,
                )}
                folders={folders}
                downloadedIds={downloadedIds || []}
                setDownloadedIds={setDownloadedIds}
                onOpen={() => setFolderId(folder.id)}
                onMove={handleMove}
                onRename={() => {
                  setFolderName(folder.name)
                  setFolderEditor({ folder })
                }}
                onDelete={() => deleteFolder(folder)}
              />
            ))}
          </div>
        )}
        {loading && !gptImageTasks.length ? (
          <div className="flex justify-center py-12">
            <Spin size="large" />
          </div>
        ) : catalogError ? (
          <Button onClick={refreshCatalog}>{t('请求失败')} · {t('重试')}</Button>
        ) : filteredTasks.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={searchText ? t('没有匹配的任务') : t('暂无生成任务')}
            />
          </div>
        ) : (
          <>
            <div
              ref={virtualListRef}
              className="relative"
              style={
                infiniteScroll
                  ? { height: taskVirtualizer.getTotalSize() }
                  : undefined
              }
            >
              {renderedRows.map((row) => (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={
                    infiniteScroll ? taskVirtualizer.measureElement : undefined
                  }
                  className={
                    panelMode
                      ? 'grid grid-cols-1 gap-2'
                      : managementMode
                        ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-2 sm:gap-4'
                        : 'grid grid-cols-1 gap-4 md:grid-cols-2'
                  }
                  style={
                    infiniteScroll
                      ? {
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${row.start - scrollMargin}px)`,
                        }
                      : undefined
                  }
                >
                  {row.tasks.map((task) => {
                    const actions = taskListActions(task)
                    const active = task.id === selectedTaskId
                    const reviewing =
                      managementMode && task.id === reviewedTaskId
                    const selected = selectedIds.includes(task.id)
                    if (task.video) return <div key={task.id} className="w-full">
                      {selectionMode && <Checkbox checked={selected} onChange={() => toggleTaskSelection(task.id)}>{t('选择任务')}</Checkbox>}
                      <VideoTaskCard task={task} />
                    </div>
                    return (
                      <Card
                        key={task.id}
                        ref={(node) => {
                          if (node) taskCardRefs.current.set(task.id, node)
                          else taskCardRefs.current.delete(task.id)
                        }}
                        size="small"
                        draggable={!isMobile && !moving}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData(
                            'application/x-linai-task',
                            JSON.stringify(
                              selectionMode && selected
                                ? selectedIds
                                : [task.id],
                            ),
                          )
                        }}
                        aria-current={reviewing ? 'true' : undefined}
                        onClick={() =>
                          selectionMode
                            ? toggleTaskSelection(task.id)
                            : onSelectTask?.(task.id)
                        }
                        className={`task-list-card w-full transition-all ${
                          onSelectTask || selectionMode ? 'cursor-pointer' : ''
                        } ${
                          active || selected
                            ? 'task-list-card-active'
                            : 'shadow-sm'
                        } ${reviewing ? 'task-list-card-reviewing' : ''}`}
                        classNames={{
                          body: 'task-list-card-body p-2! transition-colors duration-100 md:p-[10px]!',
                        }}
                      >
                        {(selectionMode || reviewing) && (
                          <div
                            className="mb-2 flex items-center gap-2 text-xs text-slate-400"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {selectionMode && (
                              <>
                                <Checkbox
                                  checked={selected}
                                  onChange={() => toggleTaskSelection(task.id)}
                                />
                                {t('选择任务')}
                              </>
                            )}
                            {reviewing && (
                              <span className="task-list-review-badge ml-auto">
                                <EyeOutlined />
                                {t('当前审阅')}
                              </span>
                            )}
                          </div>
                        )}
                        <div
                          className={
                            panelMode
                              ? 'task-list-card-layout flex gap-3'
                              : managementMode
                                ? 'task-list-card-layout flex gap-2 sm:gap-4'
                                : 'task-list-card-layout flex gap-4'
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
                                  {t('生成失败')}
                                </Typography.Text>
                                <Typography.Text
                                  type="danger"
                                  className="w-full cursor-pointer text-center text-xs transition-colors hover:text-red-400!"
                                  ellipsis={{ tooltip: task.error }}
                                  onClick={() => {
                                    if (task.error) {
                                      copy(task.error)
                                      message.success(t('错误信息已复制'))
                                    }
                                  }}
                                >
                                  {task.error}
                                </Typography.Text>
                              </div>
                            ) : task.outputUrls.length === 0 ? (
                              <div className="flex w-full flex-col items-center justify-center gap-1 p-2 text-center">
                                <Typography.Text
                                  strong
                                  className="text-amber-400!"
                                >
                                  {t('运行中')}
                                </Typography.Text>
                                <SyncOutlined className="text-amber-400" spin />
                              </div>
                            ) : task.outputUrls.length > 1 ? (
                              <div className="flex h-full w-full items-center justify-center">
                                <ImageGroup
                                  images={task.outputUrls}
                                  width={panelMode ? 90 : 100}
                                  height={panelMode ? 120 : 130}
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
                                  gptImageSettings.showImageSizeInTaskList ??
                                  true
                                }
                              />
                            )}
                          </div>

                          <div className="task-list-card-details flex min-w-0 grow flex-col justify-between overflow-hidden">
                            <div className="task-list-card-summary">
                              <div
                                className={`task-list-card-tags ${isMobile ? 'flex items-start justify-between gap-2' : ''}`}
                              >
                                <TaskItemTags
                                  task={task}
                                  downloadedIds={downloadedIds || []}
                                  compact={panelMode || managementMode}
                                  dense={panelMode}
                                  showEndpoint={!panelMode}
                                  showMetrics={!isMobile}
                                  showDuration={isMobile && panelMode}
                                />
                                {isMobile && panelMode && (
                                  <TaskItemMetrics
                                    task={task}
                                    className="task-list-card-panel-metrics"
                                    showDuration={false}
                                  />
                                )}
                              </div>
                              <div className="task-list-card-heading flex min-w-0 flex-col gap-1">
                                <div className="task-list-card-title flex min-w-0 items-center gap-2">
                                  {task.rawTemplate?.title && (
                                    <Typography.Text
                                      strong
                                      className="min-w-0 flex-1 truncate"
                                      title={task.rawTemplate.title}
                                    >
                                      {task.rawTemplate.title}
                                    </Typography.Text>
                                  )}
                                  {(!isMobile || !managementMode) && (
                                    <div className="shrink-0 text-[11px] text-slate-500">
                                      {dayjs(task.createdAt).format(
                                        'YY/MM/DD HH:mm',
                                      )}
                                    </div>
                                  )}
                                </div>
                                {isMobile && !panelMode && (
                                  <TaskItemMetrics task={task} />
                                )}
                              </div>
                              {task.rawTemplate?.prompt && (
                                <Typography.Paragraph
                                  type="secondary"
                                  className="task-list-card-prompt app-accent-hover mb-0! cursor-pointer text-xs transition-colors"
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
                                      message.success(t('提示词已复制'))
                                    }
                                  }}
                                >
                                  {task.rawTemplate.prompt}
                                </Typography.Paragraph>
                              )}
                            </div>

                            {((isMobile && managementMode) ||
                              !selectionMode ||
                              task.originalPrompt !== undefined) && (
                              <div
                                className={`task-list-card-actions flex min-w-0 items-center ${
                                  panelMode || (isMobile && managementMode)
                                    ? 'justify-between gap-2'
                                    : 'justify-end'
                                }`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {isMobile && managementMode && (
                                  <div className="mr-auto shrink-0 text-[11px] whitespace-nowrap text-slate-500">
                                    {dayjs(task.createdAt).format(
                                      'YY/MM/DD HH:mm',
                                    )}
                                  </div>
                                )}
                                {panelMode && (
                                  <Tooltip
                                    title={task.endpointName || t('未记录端点')}
                                  >
                                    <div className="task-list-card-endpoint flex min-w-0 items-center gap-1 text-[11px] text-violet-300/80">
                                      <GlobalOutlined className="shrink-0" />
                                      <span className="truncate">
                                        {task.endpointName || t('未知端点')}
                                      </span>
                                    </div>
                                  </Tooltip>
                                )}
                                <div
                                  className={`task-list-card-buttons flex items-center gap-0.5 ${managementMode ? 'flex-wrap justify-end' : ''}`}
                                >
                                  {task.originalPrompt !== undefined && (
                                    <Tooltip title={t('查看优化前的提示词')}>
                                      <Button
                                        type="text"
                                        icon={<BulbOutlined />}
                                        onClick={() =>
                                          setOriginalPromptView({
                                            text: task.originalPrompt || '',
                                          })
                                        }
                                        aria-label={t('查看优化前的提示词')}
                                        className="text-amber-300!"
                                      />
                                    </Tooltip>
                                  )}
                                  {!selectionMode && (
                                    <>
                                      {task.outputUrls.length > 0 && (
                                        <CopyToStudioButton
                                          taskId={task.id}
                                          count={task.outputUrls.length}
                                        />
                                      )}
                                      {managementMode && actions.addToTemplate && (
                                        <Tooltip title={t('添加到模板')}>
                                          <Button
                                            type="primary"
                                            size="small"
                                            icon={<FileAddOutlined />}
                                            onClick={() =>
                                              runTaskAction(
                                                task,
                                                'addToTemplate',
                                                handleAddToTemplate,
                                              )
                                            }
                                            loading={
                                              loadingActions.get(task.id) === 'addToTemplate'
                                            }
                                            disabled={loadingActions.has(task.id)}
                                            aria-label={t('添加到模板')}
                                            className="px-2! sm:px-3!"
                                          >
                                            <span className="hidden sm:inline">
                                              {t('添加到模板')}
                                            </span>
                                          </Button>
                                        </Tooltip>
                                      )}
                                      {actions.refill && (
                                        <Tooltip title={t('重新填入')}>
                                          <Button
                                            type="text"
                                            icon={
                                              <VerticalAlignTopOutlined />
                                            }
                                            onClick={() =>
                                              runTaskAction(task, 'refill', handleRefill)
                                            }
                                            loading={loadingActions.get(task.id) === 'refill'}
                                            disabled={loadingActions.has(task.id)}
                                            aria-label={t('重新填入')}
                                          />
                                        </Tooltip>
                                      )}
                                      {task.outputUrls.length > 0 && (
                                        <TaskItemDownloadButton
                                          taskId={task.id}
                                          folder={
                                            folders.find(
                                              (folder) =>
                                                folder.id === task.folderId,
                                            )?.name
                                          }
                                          outputUrls={task.outputUrls}
                                          fileName={
                                            task.rawTemplate?.title ||
                                            task.rawTemplate?.prompt ||
                                            `task_${task.id}`
                                          }
                                          endpointName={task.endpointName}
                                          createdAt={task.createdAt}
                                          onDownloaded={() => {
                                            if (
                                              !downloadedIds?.includes(task.id)
                                            ) {
                                              setDownloadedIds([
                                                ...(downloadedIds || []),
                                                task.id,
                                              ])
                                            }
                                          }}
                                        />
                                      )}
                                      {actions.retry && (
                                        <Tooltip title={t('重试')}>
                                          <Button
                                            type="text"
                                            icon={<RedoOutlined />}
                                            onClick={() =>
                                              runTaskAction(task, 'retry', handleRetry)
                                            }
                                            disabled={loadingActions.has(task.id)}
                                            loading={
                                              retryingTaskId === task.id ||
                                              loadingActions.get(task.id) === 'retry'
                                            }
                                          />
                                        </Tooltip>
                                      )}
                                      <TaskItemDeleteButton
                                        id={task.id}
                                        status={task.status}
                                      />
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              ))}
            </div>

            {!infiniteScroll && filteredTasks.length > pageSize && (
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
            )}
          </>
        )}
      </div>
      <Modal
        title={t('删除图片还是整个任务？')}
        open={reviewDeleteChoice !== null}
        closable={!reviewDeleting}
        maskClosable={!reviewDeleting}
        keyboard={!reviewDeleting}
        onCancel={() => {
          if (!reviewDeleting) setReviewDeleteChoice(null)
        }}
        footer={[
          <Button
            key="cancel"
            disabled={reviewDeleting}
            onClick={() => setReviewDeleteChoice(null)}
          >
            {t('取消')}
          </Button>,
          <Button
            key="image"
            danger
            disabled={reviewDeleting}
            loading={reviewDeleting}
            onClick={async () => {
              if (
                reviewDeleteChoice &&
                (await deleteReviewedImage(reviewDeleteChoice))
              ) {
                setReviewDeleteChoice(null)
              }
            }}
          >
            {t('只删除这张图片')}
          </Button>,
          <Button
            key="task"
            type="primary"
            danger
            disabled={reviewDeleting}
            loading={reviewDeleting}
            onClick={async () => {
              if (
                reviewDeleteChoice &&
                (await deleteReviewedTask(reviewDeleteChoice))
              ) {
                setReviewDeleteChoice(null)
              }
            }}
          >
            {t('删除整个任务')}
          </Button>,
        ]}
      >
        <p className="mb-2">
          {t('这个任务包含多张图片。你可以只移除当前图片，或删除整个任务。')}
        </p>
        <p className="mb-0 text-sm text-slate-400">
          {gptImageSettings.keepImageWhenDeleteTask
            ? t(
                '当前设置：删除整个任务时保留图片文件；只删除当前图片仍会删除该图片文件。',
              )
            : t('当前设置：删除整个任务时会同时删除其中所有图片文件。')}
        </p>
      </Modal>
      <Modal
        title={folderEditor?.folder ? t('重命名文件夹') : t('新建文件夹')}
        open={folderEditor !== null}
        onCancel={() => setFolderEditor(null)}
        onOk={saveFolder}
        confirmLoading={savingFolder}
        okText={t('保存')}
        cancelText={t('取消')}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label={t('文件夹名称')}>
            <Input
              autoFocus
              maxLength={100}
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              onPressEnter={() => {
                if (!savingFolder) void saveFolder()
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={t('移动选中的 {0} 个任务', [selectedIds.length])}
        open={moveOpen}
        onCancel={() => setMoveOpen(false)}
        onOk={() => handleMove(selectedIds, moveFolderId)}
        confirmLoading={moving}
        okButtonProps={{ disabled: !selectedIds.length }}
        okText={t('移动')}
        cancelText={t('取消')}
      >
        <Select
          className="w-full"
          showSearch
          optionFilterProp="label"
          value={moveFolderId}
          onChange={setMoveFolderId}
          options={[
            { value: '', label: t('主文件夹') },
            ...folders.map((folder) => ({
              value: folder.id,
              label: folder.name,
            })),
          ]}
        />
      </Modal>
      <Modal
        title={t('优化前的提示词')}
        open={originalPromptView !== null}
        // Image previews default to zIndexPopupBase + 80.
        zIndex={token.zIndexPopupBase + 100}
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
              message.success(t('优化前的提示词已复制'))
            }}
          >
            {t('复制')}
          </Button>,
          <Button
            key="close"
            type="primary"
            onClick={() => setOriginalPromptView(null)}
          >
            {t('关闭')}
          </Button>,
        ]}
      >
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-slate-700 bg-slate-950/40 p-3 text-sm break-words whitespace-pre-wrap text-slate-200">
          {originalPromptView?.text || t('（优化前未填写文字提示词）')}
        </div>
      </Modal>
    </>
  )

  if (panelMode) {
    return (
      <div className="task-list-container flex h-full min-h-0 min-w-0 flex-col px-3">
        {taskContent}
      </div>
    )
  }

  return (
    <Card
      className={
        managementMode
          ? 'task-list-container task-list-management-shell w-full min-w-0 shadow-none! sm:shadow-sm'
          : 'task-list-container w-full min-w-0 border-[#303640] shadow-sm'
      }
      classNames={{
        body: managementMode ? 'p-0! sm:px-3! md:px-6!' : 'px-3! md:px-6!',
      }}
      styles={{ body: { paddingTop: 0 } }}
    >
      {taskContent}
      {managementMode && (
        <TaskReviewPreview
          images={presentedReviewImages}
          current={presentedReviewIndex}
          onChange={(index) => {
            if (originalPromptView !== null) return
            const image = presentedReviewImages[index]
            if (image) showReviewImage(image)
          }}
          onClose={() => {
            setOriginalPromptView(null)
            setReviewOrphaned(false)
            setReviewImage(null)
          }}
          onAfterClose={scrollToReviewedTask}
          selectionMode={selectionMode}
          selected={Boolean(
            reviewImage && selectedIds.includes(reviewImage.taskId),
          )}
          canDelete={Boolean(currentReviewTask) && !reviewOrphaned}
          canAddToTemplate={canAddCurrentReviewToTemplate && !reviewOrphaned}
          canSelect={Boolean(currentReviewTask) && !reviewOrphaned}
          canViewOriginalPrompt={
            currentReviewTask?.originalPrompt !== undefined && !reviewOrphaned
          }
          originalPromptOpen={originalPromptView !== null}
          onViewOriginalPrompt={() => {
            if (currentReviewTask?.originalPrompt !== undefined) {
              setOriginalPromptView({ text: currentReviewTask.originalPrompt })
            }
          }}
          deleting={reviewDeleting}
          onDelete={handleDeleteReviewedItem}
          onAddToTemplate={() => {
            if (currentReviewTask && !selectionMode) {
              handleAddToTemplate(currentReviewTask)
            }
          }}
          onToggleSelection={toggleReviewedTaskSelection}
          onExitSelectionMode={exitSelectionMode}
        />
      )}
    </Card>
  )
}
