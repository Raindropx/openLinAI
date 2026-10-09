import { Modal, Spin, Tabs } from 'antd'
import { hc } from 'hono/client'
import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppType } from '../../../../../server'
import {
  GENERATED_IMAGES_API_PATH,
  INPUT_IMAGES_API_PATH,
} from '../../../../../server/common/static/enum'
import { useRecentImages } from '../../../../hooks/useRecentImages'
import { useTasks } from '../../../../hooks/useTasks'
import { useTemplates } from '../../../../hooks/useTemplates'
import { t, useAppLanguage } from '../../../../i18n'
import { AppThemeProvider } from '../../../../theme'
import type { GalleryDeleteSuccessPayload } from './Footer'
import { GalleryFooter } from './Footer'
import {
  collectGalleryImageReferences,
  normalizeComparableUrl,
  resolveGalleryReference,
} from './references'

const client = hc<AppType>('/')

interface GalleryModalProps {
  visible: boolean
  onClose: () => void
  onSelect: (images: GalleryImageSelection[]) => void
  maxCount?: number
}

type ImageFile = {
  url: string
  type: 'input' | 'generated'
  createdAt: number
}

type ImageItem = ImageFile & {
  isReferenced: boolean
}

export type GalleryImageSelection = Pick<ImageItem, 'url' | 'type'>

const isManagedGalleryUrl = (url: string) => {
  const normalizedUrl = normalizeComparableUrl(url)
  return (
    normalizedUrl.startsWith(`${INPUT_IMAGES_API_PATH}/`) ||
    normalizedUrl.startsWith(`${GENERATED_IMAGES_API_PATH}/`)
  )
}

function GalleryModal({
  visible,
  onClose,
  onSelect,
  maxCount,
}: GalleryModalProps) {
  useAppLanguage()

  const [activeKey, setActiveKey] = useState('recent')
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([])
  const [loading, setLoading] = useState(false)
  const [imagesLoadSucceeded, setImagesLoadSucceeded] = useState(false)
  const [selectedUrls, setSelectedUrls] = useState<string[]>([])
  const { recentImages, removeRecentImages } = useRecentImages()
  const { data: templates = [], loading: templatesLoading } = useTemplates()
  const { data: tasks = [], loading: tasksLoading } = useTasks()

  const referencesReady = !templatesLoading && !tasksLoading

  const getComparableImageUrl = (
    type: ImageItem['type'],
    url: string,
  ): string | null => {
    const apiPath =
      type === 'input' ? INPUT_IMAGES_API_PATH : GENERATED_IMAGES_API_PATH
    const normalizedUrl = normalizeComparableUrl(url)

    if (!normalizedUrl.startsWith(`${apiPath}/`)) {
      return null
    }

    return normalizedUrl
  }

  const templateReferencedUrls = useMemo(
    () => collectGalleryImageReferences(templates),
    [templates],
  )

  const taskReferencedUrls = useMemo(
    () => collectGalleryImageReferences(tasks),
    [tasks],
  )

  const images = useMemo<ImageItem[]>(
    () =>
      imageFiles.map((image) => ({
        ...image,
        isReferenced:
          !referencesReady ||
          !getComparableImageUrl(image.type, image.url) ||
          resolveGalleryReference(
            image.url,
            templateReferencedUrls,
            taskReferencedUrls,
          ) !== 'none',
      })),
    [imageFiles, referencesReady, templateReferencedUrls, taskReferencedUrls],
  )

  const imageByUrl = useMemo(
    () => new Map(images.map((image) => [image.url, image])),
    [images],
  )

  const availableComparableUrlSet = useMemo(
    () => new Set(images.map((image) => normalizeComparableUrl(image.url))),
    [images],
  )

  const visibleRecentImages = useMemo(() => {
    if (!imagesLoadSucceeded) {
      return recentImages
    }

    return recentImages.filter(
      (url) =>
        !isManagedGalleryUrl(url) ||
        availableComparableUrlSet.has(normalizeComparableUrl(url)),
    )
  }, [availableComparableUrlSet, imagesLoadSucceeded, recentImages])

  const invalidRecentImages = useMemo(() => {
    if (!imagesLoadSucceeded) {
      return []
    }

    return recentImages.filter(
      (url) =>
        isManagedGalleryUrl(url) &&
        !availableComparableUrlSet.has(normalizeComparableUrl(url)),
    )
  }, [availableComparableUrlSet, imagesLoadSucceeded, recentImages])

  const selectionOrderMap = useMemo(
    () => new Map(selectedUrls.map((url, index) => [url, index + 1])),
    [selectedUrls],
  )

  useEffect(() => {
    if (visible && referencesReady) {
      fetchImages()
    }
  }, [visible, referencesReady])

  useEffect(() => {
    if (invalidRecentImages.length === 0) {
      return
    }

    removeRecentImages(invalidRecentImages)
    const invalidUrlSet = new Set(invalidRecentImages)
    setSelectedUrls((prev) => prev.filter((url) => !invalidUrlSet.has(url)))
  }, [invalidRecentImages, removeRecentImages])

  const fetchImages = async (): Promise<ImageFile[] | null> => {
    setLoading(true)
    setImagesLoadSucceeded(false)
    try {
      const res = await client.api.static.images.list.$get()
      const data = await res.json()
      if (data.success) {
        const nextImages = data.data as ImageFile[]
        setImageFiles(nextImages)
        setImagesLoadSucceeded(true)
        return nextImages
      }
    } catch (e) {
      console.error('Failed to fetch images', e)
    } finally {
      setLoading(false)
    }

    return null
  }

  const handleSelect = (url: string) => {
    setSelectedUrls((prev) => {
      if (prev.includes(url)) return prev.filter((item) => item !== url)
      if (maxCount === 1) return [url]
      if (maxCount && prev.length >= maxCount) return prev
      return [...prev, url]
    })
  }

  const handleConfirm = () => {
    if (selectedUrls.length === 0) {
      return
    }

    onSelect(
      selectedUrls.map((url) => ({
        url,
        type: resolveImageType(url) ?? 'input',
      })),
    )
    onClose()
  }

  const resolveImageType = (url: string): ImageItem['type'] | undefined => {
    const image = imageByUrl.get(url)
    if (image) {
      return image.type
    }
    if (url.includes(INPUT_IMAGES_API_PATH)) {
      return 'input'
    }

    if (url.includes(GENERATED_IMAGES_API_PATH)) {
      return 'generated'
    }

    return undefined
  }
  const handleDeleteImages = async ({ urls }: GalleryDeleteSuccessPayload) => {
    const nextImages = await fetchImages()
    if (!nextImages) {
      return
    }
    const existingUrlSet = new Set(nextImages.map((image) => image.url))

    setSelectedUrls((prev) =>
      prev.filter((url) => !urls.includes(url) || existingUrlSet.has(url)),
    )
  }

  const renderImageGrid = (urls: string[]) => {
    if (urls.length === 0) {
      return (
        <div className="p-8 text-center text-slate-400">{t('暂无图片')}</div>
      )
    }
    return (
      <div className="grid max-h-[60vh] grid-cols-3 gap-4 overflow-y-auto p-2 md:grid-cols-4 lg:grid-cols-5">
        {urls.map((url, i) =>
          (() => {
            const order = selectionOrderMap.get(url)
            const selected = typeof order === 'number'
            const reference = resolveGalleryReference(
              url,
              templateReferencedUrls,
              taskReferencedUrls,
            )

            return (
              <div
                key={`${url}-${i}`}
                className={`relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 bg-slate-100 transition-all ${
                  selected
                    ? 'border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.15)]'
                    : 'border-transparent hover:border-blue-500'
                }`}
                onClick={() => handleSelect(url)}
              >
                <img
                  src={`${url}${url.includes('?') ? '&' : '?'}thumb=true`}
                  alt="gallery item"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {referencesReady && reference === 'task' ? (
                  <div className="absolute top-1 left-1 z-10 rounded bg-blue-500 px-2 py-0.5 text-xs text-white shadow-sm">
                    {t('已参考')}
                  </div>
                ) : (
                  referencesReady &&
                  imageByUrl.get(url)?.isReferenced === false && (
                    <div className="absolute top-1 left-1 z-10 rounded bg-red-500 px-2 py-0.5 text-xs text-white shadow-sm">
                      {t('无引用')}
                    </div>
                  )
                )}
                <div
                  className={`absolute inset-0 flex items-center justify-center transition-colors ${
                    selected ? 'bg-blue-500/45' : 'bg-black/0 hover:bg-black/5'
                  }`}
                >
                  {selected && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-semibold text-blue-600 shadow-sm">
                      {order}
                    </div>
                  )}
                </div>
              </div>
            )
          })(),
        )}
      </div>
    )
  }

  return (
    <Modal
      title={t('选择图片')}
      open={visible}
      onCancel={onClose}
      footer={
        referencesReady ? (
          <GalleryFooter
            activeKey={activeKey}
            selectedUrls={selectedUrls}
            images={images}
            onCancel={onClose}
            onConfirm={handleConfirm}
            onDelete={handleDeleteImages}
          />
        ) : null
      }
      width={800}
      destroyOnHidden
    >
      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          {
            key: 'recent',
            label: t('最近使用'),
            children: renderImageGrid(visibleRecentImages),
          },
          {
            key: 'input',
            label: t('输入图片'),
            children:
              loading || !referencesReady ? (
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
            label: t('生成图片'),
            children:
              loading || !referencesReady ? (
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

export function openGallery(options: {
  onSelect: (images: GalleryImageSelection[]) => void
  maxCount?: number
}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  const handleClose = () => {
    root.render(
      <AppThemeProvider>
        <GalleryModal
          visible={false}
          onClose={destroy}
          onSelect={options.onSelect}
          maxCount={options.maxCount}
        />
      </AppThemeProvider>,
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
    <AppThemeProvider>
      <GalleryModal
        visible={true}
        onClose={handleClose}
        onSelect={options.onSelect}
        maxCount={options.maxCount}
      />
    </AppThemeProvider>,
  )
}
