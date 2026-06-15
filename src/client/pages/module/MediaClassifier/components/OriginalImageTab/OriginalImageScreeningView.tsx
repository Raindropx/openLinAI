import {
  DeleteOutlined,
  EnterOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { Button, Card, Empty, Space, Spin, Typography } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo } from 'react'
import type { MediaDecisionStatus, MediaImageItem } from '../../types'

interface OriginalImageScreeningViewProps {
  images: MediaImageItem[]
  loading: boolean
  currentIndex: number
  onChangeIndex: (index: number) => void
  onMark: (
    relativePath: string,
    status: MediaDecisionStatus,
    autoAdvance?: boolean,
  ) => Promise<void>
  actionKey: string | null
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

export function OriginalImageScreeningView({
  images,
  loading,
  currentIndex,
  onChangeIndex,
  onMark,
  actionKey,
}: OriginalImageScreeningViewProps) {
  const currentImage = images[currentIndex]
  const pendingCount = useMemo(
    () => images.filter((image) => image.status === 'pending').length,
    [images],
  )

  useEffect(() => {
    if (!currentImage) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      if (
        target?.isContentEditable ||
        tagName === 'input' ||
        tagName === 'textarea'
      ) {
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        void onMark(currentImage.relativePath, 'keep', true)
        return
      }

      if (event.key === 'd' || event.key === 'D') {
        event.preventDefault()
        void onMark(currentImage.relativePath, 'delete', true)
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onChangeIndex(Math.max(currentIndex - 1, 0))
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        onChangeIndex(Math.min(currentIndex + 1, images.length - 1))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentImage, currentIndex, images.length, onChangeIndex, onMark])

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Spin />
      </div>
    )
  }

  if (!currentImage) {
    return <Empty description="当前没有可筛选的图片" />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <Space wrap>
          <Typography.Text strong>
            {currentIndex + 1} / {images.length}
          </Typography.Text>
          <Typography.Text type="secondary">
            待筛选 {pendingCount} 张
          </Typography.Text>
        </Space>
        <Space wrap>
          <Button
            icon={<LeftOutlined />}
            disabled={currentIndex <= 0}
            onClick={() => onChangeIndex(Math.max(currentIndex - 1, 0))}
          >
            上一张
          </Button>
          <Button
            icon={<RightOutlined />}
            disabled={currentIndex >= images.length - 1}
            onClick={() =>
              onChangeIndex(Math.min(currentIndex + 1, images.length - 1))
            }
          >
            下一张
          </Button>
        </Space>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          className="border-slate-200 shadow-sm"
          classNames={{ body: 'p-3! md:p-5!' }}
        >
          <div className="flex min-h-[500px] items-center justify-center rounded-2xl bg-slate-100 p-4">
            <img
              src={currentImage.previewUrl}
              alt={currentImage.name}
              className="max-h-[70vh] max-w-full rounded-xl object-contain shadow-sm"
            />
          </div>
        </Card>

        <Card
          className="border-slate-200 shadow-sm"
          classNames={{ body: 'flex h-full flex-col gap-4 p-4!' }}
        >
          <div>
            <Typography.Title level={5} className="mb-2!">
              {currentImage.name}
            </Typography.Title>
            <div className="space-y-2 text-sm text-slate-500">
              <div>相对路径：{currentImage.relativePath}</div>
              <div>文件大小：{formatFileSize(currentImage.size)}</div>
              <div>
                修改时间：
                {dayjs(currentImage.mtimeMs).format('YYYY-MM-DD HH:mm')}
              </div>
            </div>
          </div>

          <div className="mt-auto space-y-3">
            <Button
              type="primary"
              size="large"
              className="w-full"
              icon={<EnterOutlined />}
              loading={actionKey === `${currentImage.relativePath}:keep`}
              onClick={() =>
                void onMark(currentImage.relativePath, 'keep', true)
              }
            >
              保留（回车）
            </Button>
            <Button
              danger
              size="large"
              className="w-full"
              icon={<DeleteOutlined />}
              loading={actionKey === `${currentImage.relativePath}:delete`}
              onClick={() =>
                void onMark(currentImage.relativePath, 'delete', true)
              }
            >
              删除（D）
            </Button>
            {currentImage.status !== 'pending' && (
              <Button
                size="large"
                className="w-full"
                icon={<ReloadOutlined />}
                loading={actionKey === `${currentImage.relativePath}:pending`}
                onClick={() =>
                  void onMark(currentImage.relativePath, 'pending', false)
                }
              >
                重置为待筛选
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
