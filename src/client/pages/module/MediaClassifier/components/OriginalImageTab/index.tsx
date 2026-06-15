import { Button, Card, Segmented, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { updateMediaLocalMark } from '../../localMarks'
import type {
  MediaDecisionStatus,
  MediaImageItem,
  MediaImageListResult,
} from '../../types'
import { OriginalImageList } from './OriginalImageList'
import { OriginalImageScreeningView } from './OriginalImageScreeningView'

const LIST_PAGE_SIZE = 24

interface OriginalImageTabProps {
  images: MediaImageItem[]
  loading: boolean
  onImagesChange: (images: MediaImageItem[]) => void
}

export function OriginalImageTab({
  images,
  loading,
  onImagesChange,
}: OriginalImageTabProps) {
  const [viewMode, setViewMode] = useState<'list' | 'screen'>('list')
  const [hasMountedScreenView, setHasMountedScreenView] = useState(false)
  const [listPage, setListPage] = useState(1)
  const [screeningIndex, setScreeningIndex] = useState(0)
  const [actionKey, setActionKey] = useState<string | null>(null)
  const [selectedRelativePaths, setSelectedRelativePaths] = useState<
    Set<string>
  >(() => new Set())

  useEffect(() => {
    if (viewMode === 'screen') {
      setHasMountedScreenView(true)
    }
  }, [viewMode])

  useEffect(() => {
    const maxPage = Math.max(Math.ceil(images.length / LIST_PAGE_SIZE), 1)
    setListPage((currentPage) => Math.min(currentPage, maxPage))
    setScreeningIndex((currentIndex) =>
      Math.min(currentIndex, Math.max(images.length - 1, 0)),
    )
  }, [images.length])

  const listData = useMemo<MediaImageListResult | null>(() => {
    if (images.length === 0) {
      return null
    }

    const start = (listPage - 1) * LIST_PAGE_SIZE
    const end = start + LIST_PAGE_SIZE
    return {
      items: images.slice(start, end),
      total: images.length,
      page: listPage,
      pageSize: LIST_PAGE_SIZE,
      hasMore: end < images.length,
    }
  }, [images, listPage])

  useEffect(() => {
    if (viewMode !== 'list') {
      setSelectedRelativePaths(new Set())
    }
  }, [viewMode])

  useEffect(() => {
    const visibleRelativePaths = new Set(
      (listData?.items ?? []).map((item) => item.relativePath),
    )
    setSelectedRelativePaths((currentSelected) => {
      if (currentSelected.size === 0) {
        return currentSelected
      }

      const nextSelected = new Set(
        [...currentSelected].filter((relativePath) =>
          visibleRelativePaths.has(relativePath),
        ),
      )

      return nextSelected.size === currentSelected.size
        ? currentSelected
        : nextSelected
    })
  }, [listData])

  const handleMark = async (
    relativePath: string,
    status: MediaDecisionStatus,
  ) => {
    setActionKey(`${relativePath}:${status}`)
    try {
      const targetImage = images.find(
        (item) => item.relativePath === relativePath,
      )
      if (!targetImage) {
        throw new Error('图片不存在')
      }

      const updatedImage = updateMediaLocalMark(targetImage, status)
      const nextImages = images.map((item) =>
        item.relativePath === updatedImage.relativePath ? updatedImage : item,
      )
      onImagesChange(nextImages)
    } catch (error: any) {
      message.error(error.message || '更新图片状态失败')
    } finally {
      setActionKey(null)
    }
  }

  const handleToggleSelect = (relativePath: string) => {
    setSelectedRelativePaths((currentSelected) => {
      const nextSelected = new Set(currentSelected)
      if (nextSelected.has(relativePath)) {
        nextSelected.delete(relativePath)
      } else {
        nextSelected.add(relativePath)
      }
      return nextSelected
    })
  }

  const handleViewModeChange = (nextViewMode: 'list' | 'screen') => {
    if (nextViewMode === viewMode) {
      return
    }

    if (nextViewMode === 'screen') {
      const firstItemIndex = (listPage - 1) * LIST_PAGE_SIZE
      setScreeningIndex(
        Math.min(firstItemIndex, Math.max(images.length - 1, 0)),
      )
    } else {
      const targetPage = Math.floor(screeningIndex / LIST_PAGE_SIZE) + 1
      const maxPage = Math.max(Math.ceil(images.length / LIST_PAGE_SIZE), 1)
      setListPage(Math.min(targetPage, maxPage))
    }

    setViewMode(nextViewMode)
  }

  const handleBatchMark = async (status: MediaDecisionStatus) => {
    const currentPageItems = listData?.items ?? []
    const targetRelativePaths =
      selectedRelativePaths.size > 0
        ? [...selectedRelativePaths]
        : currentPageItems.map((item) => item.relativePath)

    if (targetRelativePaths.length === 0) {
      return
    }

    setActionKey(`batch:${status}`)
    try {
      const targetRelativePathSet = new Set(targetRelativePaths)
      const nextImages = images.map((item) =>
        targetRelativePathSet.has(item.relativePath)
          ? updateMediaLocalMark(item, status)
          : item,
      )
      onImagesChange(nextImages)
      setSelectedRelativePaths(new Set())
      message.success(
        `${targetRelativePaths.length} 张图片已标记为${
          status === 'keep' ? '保留' : '预删除'
        }`,
      )
    } catch (error: any) {
      message.error(error.message || '批量更新图片状态失败')
    } finally {
      setActionKey(null)
    }
  }

  const hasSelection = selectedRelativePaths.size > 0
  const keepButtonLabel = hasSelection ? '保留选中项' : '本页全部保留'
  const deleteButtonLabel = hasSelection ? '预删除选中项' : '本页全部预删除'
  const canBatchMark = (listData?.items.length ?? 0) > 0

  return (
    <div className="space-y-4">
      <Card
        className="border-slate-200 shadow-sm"
        classNames={{ body: 'space-y-4 p-4! md:p-5!' }}
      >
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Segmented<'list' | 'screen'>
            size="large"
            value={viewMode}
            onChange={handleViewModeChange}
            options={[
              { label: '列表模式', value: 'list' },
              { label: '筛选模式', value: 'screen' },
            ]}
          />
          {viewMode === 'list' ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="primary"
                disabled={!canBatchMark}
                loading={actionKey === 'batch:keep'}
                onClick={() => void handleBatchMark('keep')}
              >
                {keepButtonLabel}
              </Button>
              <Button
                danger
                disabled={!canBatchMark}
                loading={actionKey === 'batch:delete'}
                onClick={() => void handleBatchMark('delete')}
              >
                {deleteButtonLabel}
              </Button>
            </div>
          ) : null}
        </div>

        <div className={viewMode === 'list' ? undefined : 'hidden'}>
          <OriginalImageList
            data={listData}
            loading={loading}
            page={listPage}
            onPageChange={(pageNumber) => {
              setListPage(pageNumber)
              setSelectedRelativePaths(new Set())
            }}
            selectedRelativePaths={selectedRelativePaths}
            onToggleSelect={handleToggleSelect}
          />
        </div>

        {viewMode === 'screen' || hasMountedScreenView ? (
          <div className={viewMode === 'screen' ? undefined : 'hidden'}>
            <OriginalImageScreeningView
              images={images}
              loading={loading}
              active={viewMode === 'screen'}
              currentIndex={screeningIndex}
              actionKey={actionKey}
              onChangeIndex={setScreeningIndex}
              onMark={handleMark}
            />
          </div>
        ) : null}
      </Card>
    </div>
  )
}
