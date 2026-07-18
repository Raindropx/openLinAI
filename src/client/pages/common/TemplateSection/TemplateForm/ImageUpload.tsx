import {
  CloseCircleFilled,
  PictureOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { Image as AntImage, Button, message, Upload } from 'antd'
import { hc } from 'hono/client'
import { useEffect, useRef } from 'react'
import type { AppType } from '../../../../../server'
import { useRecentImages } from '../../../../hooks/useRecentImages'
import { imageBlobToUploadDataUrl } from '../../../../utils/image'
import {
  openGallery,
  type GalleryImageSelection,
} from '../../components/Gallery'

const client = hc<AppType>('/')

interface ImageUploadProps {
  value?: string[]
  onChange?: (urls: string[]) => void
  onUploadingChange?: (isUploading: boolean) => void
  onFirstImageRatio?: (ratio: string) => void
}

const ASPECT_RATIOS = [
  { label: '21:9', value: '21:9', ratio: 21 / 9 },
  { label: '2:1', value: '2:1', ratio: 2 / 1 },
  { label: '16:9', value: '16:9', ratio: 16 / 9 },
  { label: '3:2', value: '3:2', ratio: 3 / 2 },
  { label: '4:3', value: '4:3', ratio: 4 / 3 },
  { label: '1:1', value: '1:1', ratio: 1 / 1 },
  { label: '3:4', value: '3:4', ratio: 3 / 4 },
  { label: '2:3', value: '2:3', ratio: 2 / 3 },
  { label: '9:16', value: '9:16', ratio: 9 / 16 },
  { label: '1:2', value: '1:2', ratio: 1 / 2 },
  { label: '9:21', value: '9:21', ratio: 9 / 21 },
]

function getClosestAspectRatio(width: number, height: number) {
  const targetRatio = width / height
  let closest = ASPECT_RATIOS[0]
  let minDiff = Math.abs(targetRatio - closest.ratio)

  for (let i = 1; i < ASPECT_RATIOS.length; i++) {
    const diff = Math.abs(targetRatio - ASPECT_RATIOS[i].ratio)
    if (diff < minDiff) {
      closest = ASPECT_RATIOS[i]
      minDiff = diff
    }
  }
  return closest.value
}

export function ImageUpload({
  value = [],
  onChange,
  onUploadingChange,
  onFirstImageRatio,
}: ImageUploadProps) {
  const uploadingCountRef = useRef(0)
  const { addRecentImages } = useRecentImages()

  const latestValueRef = useRef(value)
  latestValueRef.current = value

  const handleUploadCountChange = (delta: number) => {
    const newCount = Math.max(0, uploadingCountRef.current + delta)
    uploadingCountRef.current = newCount
    onUploadingChange?.(newCount > 0)
  }

  const uploadImageBase64 = async (base64: string) => {
    const res = await client.api.static.images.upload.$post({
      json: { image: base64 },
    })
    const data = await res.json()

    if (!data.success || !('url' in data)) {
      throw new Error((data as any).error || '图片上传失败')
    }

    return data.url as string
  }

  const uploadImageFromUrl = async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('图片下载失败')
    }

    const uploadDataUrl = await imageBlobToUploadDataUrl(await response.blob())
    return uploadImageBase64(uploadDataUrl)
  }

  const handleUpload = async (file: File) => {
    handleUploadCountChange(1)
    try {
      const uploadDataUrl = await imageBlobToUploadDataUrl(file)
      if (latestValueRef.current.length === 0 && onFirstImageRatio) {
        const img = new Image()
        img.onload = () => {
          const ratio = getClosestAspectRatio(img.width, img.height)
          onFirstImageRatio(ratio)
        }
        img.src = uploadDataUrl
      }

      const url = await uploadImageBase64(uploadDataUrl)
      const newUrls = [...latestValueRef.current, url]
      latestValueRef.current = newUrls
      onChange?.(newUrls)
      addRecentImages(url)
      message.success('图片上传成功')
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '图片上传请求失败',
      )
    } finally {
      handleUploadCountChange(-1)
    }
    return false
  }

  const handleUploadRef = useRef(handleUpload)
  handleUploadRef.current = handleUpload

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      if (
        e.dataTransfer?.types &&
        Array.from(e.dataTransfer.types).includes('Files')
      ) {
        if (
          e.target instanceof Element &&
          e.target.closest('.ant-upload-drag')
        ) {
          return
        }
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const handleDrop = (e: DragEvent) => {
      if (
        e.dataTransfer?.types &&
        Array.from(e.dataTransfer.types).includes('Files')
      ) {
        if (
          e.target instanceof Element &&
          e.target.closest('.ant-upload-drag')
        ) {
          return
        }
        e.preventDefault()
        e.stopPropagation()
        const files = e.dataTransfer?.files
        if (files && files.length > 0) {
          Array.from(files).forEach((file) => {
            if (file.type.startsWith('image/')) {
              handleUploadRef.current(file)
            }
          })
        }
      }
    }

    window.addEventListener('dragover', handleDragOver, { capture: true })
    window.addEventListener('drop', handleDrop, { capture: true })

    return () => {
      window.removeEventListener('dragover', handleDragOver, { capture: true })
      window.removeEventListener('drop', handleDrop, { capture: true })
    }
  }, [])

  const handleRemove = (indexToRemove: number) => {
    const newUrls = value.filter((_, i) => i !== indexToRemove)
    latestValueRef.current = newUrls
    onChange?.(newUrls)
  }

  return (
    <div>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <Upload
          accept="image/jpeg,image/png,image/webp"
          showUploadList={false}
          beforeUpload={handleUpload}
          multiple
          className="min-w-0 w-full [&_.ant-upload]:w-full"
        >
          <Button
            icon={<UploadOutlined />}
            className="h-auto! min-h-8 w-full whitespace-normal py-1!"
          >
            拖入/选择本地图片
          </Button>
        </Upload>
        <Button
          icon={<PictureOutlined />}
          className="h-auto! min-h-8 min-w-0 w-full whitespace-normal py-1!"
          onClick={() => {
            openGallery({
              onSelect: async (images: GalleryImageSelection[]) => {
                if (images.length === 0) {
                  return
                }

                if (latestValueRef.current.length === 0 && onFirstImageRatio) {
                  const img = new Image()
                  img.onload = () => {
                    const ratio = getClosestAspectRatio(img.width, img.height)
                    onFirstImageRatio(ratio)
                  }
                  img.src = images[0].url
                }

                handleUploadCountChange(images.length)
                try {
                  const processedUrls = await Promise.all(
                    images.map(({ url, type }) =>
                      type === 'generated' ? uploadImageFromUrl(url) : url,
                    ),
                  )
                  const newUrls = [...latestValueRef.current, ...processedUrls]
                  latestValueRef.current = newUrls
                  onChange?.(newUrls)
                  addRecentImages(processedUrls)
                } catch (error) {
                  message.error(
                    error instanceof Error ? error.message : '图库图片处理失败',
                  )
                } finally {
                  handleUploadCountChange(-images.length)
                }
              },
            })
          }}
        >
          图库
        </Button>
      </div>
      {value.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
          {value.map((url, index) => (
            <div
              key={index}
              className="relative shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm"
              style={{ width: '80px', height: '120px' }}
            >
              <div
                className="absolute top-0 right-1 z-10 cursor-pointer text-xl text-red-500 drop-shadow-md transition-all"
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemove(index)
                }}
              >
                <CloseCircleFilled />
              </div>
              <AntImage
                src={url}
                alt={`preview-${index}`}
                width={80}
                height={120}
                className="object-cover"
                preview={{ src: url }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
