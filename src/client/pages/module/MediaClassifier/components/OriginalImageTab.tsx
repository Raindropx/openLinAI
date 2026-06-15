import {
  CheckOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Empty,
  Image,
  Pagination,
  Segmented,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { getAllMediaImages, getMediaImages, markMediaImage } from '../api'
import type {
  MediaDecisionStatus,
  MediaImageItem,
  MediaImageListResult,
} from '../types'
import { OriginalImageScreeningView } from './OriginalImageScreeningView'

const LIST_PAGE_SIZE = 12

interface OriginalImageTabProps {
  refreshKey: number
  onMutated: () => Promise<void> | void
}

const formatFileSize = (size: number) => {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const getStatusMeta = (status: MediaDecisionStatus) => {
  switch (status) {
    case 'keep':
      return {
        label: '保留',
        color: 'success',
      } as const
    case 'delete':
      return {
        label: '删除',
        color: 'error',
      } as const
    case 'pending':
    default:
      return {
        label: '待筛选',
        color: 'default',
      } as const
  }
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

function StatusTag({ status }: { status: MediaDecisionStatus }) {
  const meta = getStatusMeta(status)
  return <Tag color={meta.color}>{meta.label}</Tag>
}

function OriginalImageList({
  data,
  loading,
  page,
  onPageChange,
  onMark,
  actionKey,
}: {
  data: MediaImageListResult | null
  loading: boolean
  page: number
  onPageChange: (pageNumber: number) => void
  onMark: (
    relativePath: string,
    status: MediaDecisionStatus,
    autoAdvance?: boolean,
  ) => Promise<void>
  actionKey: string | null
}) {
  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin />
      </div>
    )
  }

  if (!data || data.items.length === 0) {
    return <Empty description="源目录里还没有可整理的图片" />
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.items.map((item) => (
          <Card
            key={item.relativePath}
            size="small"
            className="overflow-hidden border-slate-200 shadow-sm"
            classNames={{ body: 'p-3!' }}
          >
            <div className="space-y-3">
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                <Image
                  src={item.previewUrl}
                  alt={item.name}
                  classNames={{
                    root: 'block w-full',
                    image: 'h-56 w-full object-cover',
                  }}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <Typography.Text
                    strong
                    className="truncate"
                    title={item.name}
                  >
                    {item.name}
                  </Typography.Text>
                  <StatusTag status={item.status} />
                </div>

                <div className="space-y-1 text-xs text-slate-500">
                  <div>{item.relativePath}</div>
                  <div>
                    {formatFileSize(item.size)} ·{' '}
                    {dayjs(item.mtimeMs).format('YYYY-MM-DD HH:mm')}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type={item.status === 'keep' ? 'primary' : 'default'}
                  icon={<CheckOutlined />}
                  loading={actionKey === `${item.relativePath}:keep`}
                  onClick={() => void onMark(item.relativePath, 'keep')}
                >
                  保留
                </Button>
                <Button
                  danger
                  type={item.status === 'delete' ? 'primary' : 'default'}
                  icon={<DeleteOutlined />}
                  loading={actionKey === `${item.relativePath}:delete`}
                  onClick={() => void onMark(item.relativePath, 'delete')}
                >
                  删除
                </Button>
                {item.status !== 'pending' && (
                  <Button
                    icon={<ReloadOutlined />}
                    loading={actionKey === `${item.relativePath}:pending`}
                    onClick={() => void onMark(item.relativePath, 'pending')}
                  >
                    重置
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex justify-end">
        <Pagination
          current={page}
          pageSize={data.pageSize}
          total={data.total}
          showSizeChanger={false}
          onChange={onPageChange}
        />
      </div>
    </div>
  )
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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Typography.Title level={5} className="mb-1!">
              原始图片
            </Typography.Title>
            <Typography.Text type="secondary">
              列表模式适合批量查看，筛选模式适合快捷键快速标记。回车保留，D
              删除。
            </Typography.Text>
          </div>
          <Segmented<'list' | 'screen'>
            value={viewMode}
            onChange={setViewMode}
            options={[
              { label: '列表模式', value: 'list' },
              { label: '筛选模式', value: 'screen' },
            ]}
          />
        </div>

        {viewMode === 'list' ? (
          <OriginalImageList
            data={listData}
            loading={listLoading}
            page={listPage}
            actionKey={actionKey}
            onPageChange={(pageNumber) => void loadList(pageNumber)}
            onMark={handleMark}
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
