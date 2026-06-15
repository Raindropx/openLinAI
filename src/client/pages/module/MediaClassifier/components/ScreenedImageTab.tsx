import { Card, Empty, Image, Pagination, Spin, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { getMediaImages } from '../api'
import type { MediaImageListResult, MediaWorkspaceSnapshot } from '../types'

const PAGE_SIZE = 18

const formatFileSize = (size: number) => {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

interface ScreenedImageTabProps {
  workspace: MediaWorkspaceSnapshot | null
  refreshKey: number
}

export function ScreenedImageTab({
  workspace,
  refreshKey,
}: ScreenedImageTabProps) {
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<MediaImageListResult | null>(null)

  const isReady = Boolean(workspace?.sourceDir && workspace?.resultDir)

  const loadData = async (pageNumber = 1) => {
    if (!isReady) {
      setData(null)
      return
    }

    setLoading(true)
    try {
      const nextData = await getMediaImages('screened', pageNumber, PAGE_SIZE)
      setData(nextData)
      setPage(pageNumber)
    } catch (error: any) {
      message.error(error.message || '获取筛选后的图片失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData(1)
  }, [isReady, refreshKey])

  if (!isReady) {
    return <Empty description="请先完成目录配置" />
  }

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin />
      </div>
    )
  }

  if (!data || data.items.length === 0) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <Empty description="还没有被保留的图片" />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card
        className="border-slate-200 shadow-sm"
        classNames={{ body: 'p-4! md:p-5!' }}
      >
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <Typography.Title level={5} className="mb-1!">
              筛选后的图片
            </Typography.Title>
            <Typography.Text type="secondary">
              这里先展示已保留的图片，后续再补分类操作。
            </Typography.Text>
          </div>
          <Tag color="success">已同步到结果目录</Tag>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => (
            <Card
              key={item.relativePath}
              size="small"
              className="overflow-hidden border-slate-200"
              classNames={{ body: 'p-3!' }}
            >
              <div className="space-y-3">
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                  <Image
                    src={item.previewUrl}
                    alt={item.name}
                    classNames={{
                      root: 'block w-full',
                      image: 'h-52 w-full object-cover',
                    }}
                  />
                </div>
                <div>
                  <Typography.Text strong className="block truncate">
                    {item.name}
                  </Typography.Text>
                  <Typography.Text type="secondary" className="text-xs">
                    {item.relativePath}
                  </Typography.Text>
                </div>
                <div className="text-xs text-slate-500">
                  {formatFileSize(item.size)} ·{' '}
                  {dayjs(item.mtimeMs).format('YYYY-MM-DD HH:mm')}
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <Pagination
            current={page}
            pageSize={data.pageSize}
            total={data.total}
            showSizeChanger={false}
            onChange={(pageNumber) => void loadData(pageNumber)}
          />
        </div>
      </Card>
    </div>
  )
}
