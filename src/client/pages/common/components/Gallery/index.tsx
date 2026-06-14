import { Modal, Spin, Tabs } from 'antd'
import { hc } from 'hono/client'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppType } from '../../../../../server'

const client = hc<AppType>('/')

interface GalleryModalProps {
  visible: boolean
  onClose: () => void
  onSelect: (url: string) => void
}

type ImageItem = {
  url: string
  type: 'input' | 'generated'
  createdAt: number
}

const LOCAL_STORAGE_KEY = 'recent_uploaded_images'

function GalleryModal({ visible, onClose, onSelect }: GalleryModalProps) {
  const [activeKey, setActiveKey] = useState('recent')
  const [images, setImages] = useState<ImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [recentImages, setRecentImages] = useState<string[]>([])

  useEffect(() => {
    if (visible) {
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
        if (stored) {
          setRecentImages(JSON.parse(stored))
        }
      } catch (e) {}

      fetchImages()
    }
  }, [visible])

  const fetchImages = async () => {
    setLoading(true)
    try {
      const res = await client.api.static.images.list.$get()
      const data = await res.json()
      if (data.success) {
        setImages(data.data as ImageItem[])
      }
    } catch (e) {
      console.error('Failed to fetch images', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (url: string) => {
    onSelect(url)
    onClose()
  }

  const renderImageGrid = (urls: string[]) => {
    if (urls.length === 0) {
      return <div className="p-8 text-center text-slate-400">暂无图片</div>
    }
    return (
      <div className="grid max-h-[60vh] grid-cols-4 gap-4 overflow-y-auto p-2">
        {urls.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 border-transparent bg-slate-100 transition-colors hover:border-blue-500"
            onClick={() => handleSelect(url)}
          >
            <img
              src={`${url}${url.includes('?') ? '&' : '?'}thumb=true`}
              alt="gallery item"
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <Modal
      title="选择图片"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={800}
      destroyOnClose
    >
      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          {
            key: 'recent',
            label: '最近使用',
            children: renderImageGrid(recentImages),
          },
          {
            key: 'input',
            label: '输入图片',
            children: loading ? (
              <div className="p-8 text-center">
                <Spin />
              </div>
            ) : (
              renderImageGrid(
                images
                  .filter((img) => img.type === 'input')
                  .map((img) => img.url),
              )
            ),
          },
          {
            key: 'generated',
            label: '生成图片',
            children: loading ? (
              <div className="p-8 text-center">
                <Spin />
              </div>
            ) : (
              renderImageGrid(
                images
                  .filter((img) => img.type === 'generated')
                  .map((img) => img.url),
              )
            ),
          },
        ]}
      />
    </Modal>
  )
}

export function openGallery(options: { onSelect: (url: string) => void }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  const handleClose = () => {
    root.render(
      <GalleryModal
        visible={false}
        onClose={destroy}
        onSelect={options.onSelect}
      />,
    )
    setTimeout(destroy, 300)
  }

  const destroy = () => {
    root.unmount()
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }

  root.render(
    <GalleryModal
      visible={true}
      onClose={handleClose}
      onSelect={options.onSelect}
    />,
  )
}
