import { message } from 'antd'
import { useRef, useState, type MutableRefObject } from 'react'

export type ImageEditMode = 'crop' | 'draw'

export interface ImageEditTarget {
  mode: ImageEditMode
  index: number
  url: string
}

interface UseImageEditUploadOptions {
  latestValueRef: MutableRefObject<string[]>
  uploadImageBase64: (base64: string) => Promise<string>
  handleUploadCountChange: (delta: number) => void
  onChange?: (urls: string[]) => void
  addRecentImages: (urls: string | string[]) => void
}

const actionNames: Record<ImageEditMode, string> = {
  crop: '裁剪',
  draw: '涂抹',
}

export function useImageEditUpload({
  latestValueRef,
  uploadImageBase64,
  handleUploadCountChange,
  onChange,
  addRecentImages,
}: UseImageEditUploadOptions) {
  const [editTarget, setEditTarget] = useState<ImageEditTarget | null>(null)
  const insertedCopyCountRef = useRef(0)

  const assertTargetIsCurrent = (target: ImageEditTarget) => {
    const currentUrls = latestValueRef.current
    if (
      target.index < 0 ||
      target.index >= currentUrls.length ||
      currentUrls[target.index] !== target.url
    ) {
      throw new Error('图片列表已变化，请重新编辑')
    }
    return currentUrls
  }

  const handleEditConfirm = async (dataUrl: string) => {
    const target = editTarget
    if (!target) {
      throw new Error('未找到需要编辑的图片')
    }

    assertTargetIsCurrent(target)
    handleUploadCountChange(1)
    try {
      const newUrl = await uploadImageBase64(dataUrl)
      const currentUrls = assertTargetIsCurrent(target)
      const newUrls = [...currentUrls]
      newUrls[target.index] = newUrl
      latestValueRef.current = newUrls
      onChange?.(newUrls)
      addRecentImages(newUrl)
      setEditTarget(null)
      message.success(`图片${actionNames[target.mode]}成功`)
    } finally {
      handleUploadCountChange(-1)
    }
  }

  const handleEditCopy = async (dataUrl: string) => {
    const target = editTarget
    if (!target) {
      throw new Error('未找到需要编辑的图片')
    }

    assertTargetIsCurrent(target)
    handleUploadCountChange(1)
    try {
      const newUrl = await uploadImageBase64(dataUrl)
      const currentUrls = assertTargetIsCurrent(target)
      const insertIndex = target.index + 1 + insertedCopyCountRef.current
      const newUrls = [...currentUrls]
      newUrls.splice(insertIndex, 0, newUrl)
      insertedCopyCountRef.current += 1
      latestValueRef.current = newUrls
      onChange?.(newUrls)
      addRecentImages(newUrl)
      message.success(`已添加图片${actionNames[target.mode]}副本`)
    } finally {
      handleUploadCountChange(-1)
    }
  }

  const openEditor = (
    mode: ImageEditMode,
    target: Omit<ImageEditTarget, 'mode'>,
  ) => {
    insertedCopyCountRef.current = 0
    setEditTarget({ ...target, mode })
  }

  const closeEditor = () => {
    insertedCopyCountRef.current = 0
    setEditTarget(null)
  }

  return {
    cropTarget: editTarget?.mode === 'crop' ? editTarget : null,
    drawTarget: editTarget?.mode === 'draw' ? editTarget : null,
    openCrop: (target: Omit<ImageEditTarget, 'mode'>) =>
      openEditor('crop', target),
    openDraw: (target: Omit<ImageEditTarget, 'mode'>) =>
      openEditor('draw', target),
    closeEditor,
    handleEditConfirm,
    handleEditCopy,
  }
}
