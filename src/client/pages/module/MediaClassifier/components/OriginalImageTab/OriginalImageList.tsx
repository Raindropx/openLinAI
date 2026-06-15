import { Empty, Image, Pagination, Spin } from 'antd'
import type { MediaImageListResult } from '../../types'

interface OriginalImageListProps {
  data: MediaImageListResult | null
  loading: boolean
  page: number
  onPageChange: (pageNumber: number) => void
}

export function OriginalImageList({
  data,
  loading,
  page,
  onPageChange,
}: OriginalImageListProps) {
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
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((item) => (
          <div
            key={item.relativePath}
            className="aspect-3/4 overflow-hidden rounded bg-slate-100"
          >
            <Image
              src={item.previewUrl}
              alt={item.name}
              classNames={{
                root: 'w-full h-full',
                image: 'w-full! h-full! object-cover',
              }}
            />
          </div>
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
