import { Card, Segmented, message } from 'antd'
import { useEffect, useState } from 'react'
import { getAllMediaImages, getMediaImages, markMediaImage } from '../../api'
import type {
  MediaDecisionStatus,
  MediaImageItem,
  MediaImageListResult,
} from '../../types'
import { OriginalImageList } from './OriginalImageList'
import { OriginalImageScreeningView } from './OriginalImageScreeningView'

const LIST_PAGE_SIZE = 18

interface OriginalImageTabProps {
  refreshKey: number
  onMutated: () => Promise<void> | void
}

const resolveNextScreeningIndex = (
  images: MediaImageItem[],
  currentIndex: number,
) => {
  if (images.length === 0) {
    return 0
  }

  for (let index = currentIndex + 1; index < images.length; index += 1) {
    if (images[index].status === 'pending') {
      return index
    }
  }

  for (let index = 0; index < currentIndex; index += 1) {
    if (images[index].status === 'pending') {
      return index
    }
  }

  return Math.min(currentIndex, images.length - 1)
}

export function OriginalImageTab({
  refreshKey,
  onMutated,
}: OriginalImageTabProps) {
  const [viewMode, setViewMode] = useState<'list' | 'screen'>('list')
  const [listPage, setListPage] = useState(1)
  const [listData, setListData] = useState<MediaImageListResult | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [screeningItems, setScreeningItems] = useState<MediaImageItem[]>([])
  const [screeningLoading, setScreeningLoading] = useState(false)
  const [screeningIndex, setScreeningIndex] = useState(0)
  const [actionKey, setActionKey] = useState<string | null>(null)

  const loadList = async (pageNumber = 1) => {
    setListLoading(true)
    try {
      const data = await getMediaImages('original', pageNumber, LIST_PAGE_SIZE)
      setListData(data)
      setListPage(pageNumber)
    } catch (error: any) {
      message.error(error.message || '获取原始图片失败')
    } finally {
      setListLoading(false)
    }
  }

  const loadScreeningItems = async () => {
    setScreeningLoading(true)
    try {
      const items = await getAllMediaImages('original')
      setScreeningItems(items)
      setScreeningIndex((currentIndex) =>
        Math.min(currentIndex, Math.max(items.length - 1, 0)),
      )
    } catch (error: any) {
      message.error(error.message || '获取筛选图片失败')
    } finally {
      setScreeningLoading(false)
    }
  }

  useEffect(() => {
    void loadList(1)
  }, [refreshKey])

  useEffect(() => {
    if (viewMode === 'screen') {
      void loadScreeningItems()
    }
  }, [viewMode, refreshKey])

  useEffect(() => {
    setScreeningIndex((currentIndex) =>
      Math.min(currentIndex, Math.max(screeningItems.length - 1, 0)),
    )
  }, [screeningItems.length])

  const updateLocalImage = (nextImage: MediaImageItem) => {
    setListData((currentData) =>
      currentData
        ? {
            ...currentData,
            items: currentData.items.map((item) =>
              item.relativePath === nextImage.relativePath ? nextImage : item,
            ),
          }
        : currentData,
    )
    setScreeningItems((currentItems) =>
      currentItems.map((item) =>
        item.relativePath === nextImage.relativePath ? nextImage : item,
      ),
    )
  }

  const handleMark = async (
    relativePath: string,
    status: MediaDecisionStatus,
    autoAdvance = false,
  ) => {
    setActionKey(`${relativePath}:${status}`)
    try {
      const updatedImage = await markMediaImage(relativePath, status)
      updateLocalImage(updatedImage)

      if (autoAdvance) {
        const nextImages = screeningItems.map((item) =>
          item.relativePath === updatedImage.relativePath ? updatedImage : item,
        )
        setScreeningIndex(resolveNextScreeningIndex(nextImages, screeningIndex))
      }

      await onMutated()
    } catch (error: any) {
      message.error(error.message || '更新图片状态失败')
    } finally {
      setActionKey(null)
    }
  }

  return (
    <div className="space-y-4">
      <Card
        className="border-slate-200 shadow-sm"
        classNames={{ body: 'space-y-4 p-4! md:p-5!' }}
      >
        <Segmented<'list' | 'screen'>
          className="mb-4!"
          size="large"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { label: '列表模式', value: 'list' },
            { label: '筛选模式', value: 'screen' },
          ]}
        />

        {viewMode === 'list' ? (
          <OriginalImageList
            data={listData}
            loading={listLoading}
            page={listPage}
            onPageChange={(pageNumber) => void loadList(pageNumber)}
          />
        ) : (
          <OriginalImageScreeningView
            images={screeningItems}
            loading={screeningLoading}
            currentIndex={screeningIndex}
            actionKey={actionKey}
            onChangeIndex={setScreeningIndex}
            onMark={handleMark}
          />
        )}
      </Card>
    </div>
  )
}
