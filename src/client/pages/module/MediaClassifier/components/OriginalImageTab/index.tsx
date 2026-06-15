import { Card, Segmented, message } from 'antd'
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
  images,
  loading,
  onImagesChange,
}: OriginalImageTabProps) {
  const [viewMode, setViewMode] = useState<'list' | 'screen'>('list')
  const [listPage, setListPage] = useState(1)
  const [screeningIndex, setScreeningIndex] = useState(0)
  const [actionKey, setActionKey] = useState<string | null>(null)

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

  const handleMark = async (
    relativePath: string,
    status: MediaDecisionStatus,
    autoAdvance = false,
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

      if (autoAdvance) {
        setScreeningIndex((currentIndex) =>
          resolveNextScreeningIndex(nextImages, currentIndex),
        )
      }
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
            loading={loading}
            page={listPage}
            onPageChange={setListPage}
          />
        ) : (
          <OriginalImageScreeningView
            images={images}
            loading={loading}
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
