import { message } from 'antd'
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type SyntheticEvent,
} from 'react'
import type { PixelCrop } from 'react-image-crop'
import {
  drawStroke,
  exportEditedImage,
  getCanvasPoint,
  getEditedImageSize,
  renderEditedImage,
  type DrawStroke,
  type ImageEditOperation,
  type ImageSize,
} from './imageEditor'
import { DEFAULT_DRAW_COLOR } from './ImageDrawToolbar'
import type { BrushPreview } from './ImageEditorViewport'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4

interface UseImageEditorOptions {
  open: boolean
  src: string | null
  onConfirm: (dataUrl: string) => Promise<void>
  onConfirmCopy: (dataUrl: string) => Promise<void>
}

type SubmitAction = 'replace' | 'copy'

function isInsideCanvas(canvas: HTMLCanvasElement, x: number, y: number) {
  const rect = canvas.getBoundingClientRect()
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

export function useImageEditor({
  open,
  src,
  onConfirm,
  onConfirmCopy,
}: UseImageEditorOptions) {
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const zoomFrameRef = useRef<number | null>(null)
  const activePointerRef = useRef<number | null>(null)
  const currentStrokeRef = useRef<DrawStroke | null>(null)
  const drawingRef = useRef(false)
  const zoomRef = useRef(1)
  const lastPointerRef = useRef<{
    clientX: number
    clientY: number
    pointerType: PointerEvent<HTMLCanvasElement>['pointerType']
  } | null>(null)

  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState<ImageSize | null>(null)
  const [baseDisplaySize, setBaseDisplaySize] = useState<ImageSize | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submittingAction, setSubmittingAction] =
    useState<SubmitAction | null>(null)
  const submitting = submittingAction !== null
  const [color, setColor] = useState(DEFAULT_DRAW_COLOR)
  const [brushSize, setBrushSize] = useState(12)
  const [operations, setOperations] = useState<ImageEditOperation[]>([])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [cropMode, setCropMode] = useState(false)
  const [crop, setCrop] = useState<PixelCrop>()
  const [preview, setPreview] = useState<BrushPreview>({
    visible: false,
    x: 0,
    y: 0,
  })

  const currentOperations = operations.slice(0, historyIndex)
  const imageSize = originalSize
    ? getEditedImageSize(originalSize, currentOperations)
    : null

  const resetEditorState = () => {
    activePointerRef.current = null
    currentStrokeRef.current = null
    drawingRef.current = false
    zoomRef.current = 1
    lastPointerRef.current = null
    setOriginalSize(null)
    setBaseDisplaySize(null)
    setLoadError(null)
    setLoading(false)
    setSubmittingAction(null)
    setColor(DEFAULT_DRAW_COLOR)
    setBrushSize(12)
    setOperations([])
    setHistoryIndex(0)
    setZoom(1)
    setCropMode(false)
    setCrop(undefined)
    setPreview({ visible: false, x: 0, y: 0 })
  }

  useEffect(() => {
    if (!open || !src) {
      setObjectUrl(null)
      resetEditorState()
      return
    }

    const controller = new AbortController()
    let nextObjectUrl: string | null = null
    resetEditorState()
    setLoading(true)
    setObjectUrl(null)

    fetch(src, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('图片加载失败')
        return response.blob()
      })
      .then((blob) => {
        nextObjectUrl = URL.createObjectURL(blob)
        setObjectUrl(nextObjectUrl)
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError(error instanceof Error ? error.message : '图片加载失败')
        setLoading(false)
      })

    return () => {
      controller.abort()
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
      const canvas = canvasRef.current
      const pointerId = activePointerRef.current
      if (canvas && pointerId !== null && canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId)
      }
      if (zoomFrameRef.current !== null) {
        cancelAnimationFrame(zoomFrameRef.current)
        zoomFrameRef.current = null
      }
    }
  }, [open, src])

  useEffect(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image || !imageSize || !image.complete) return
    try {
      renderEditedImage(image, currentOperations, canvas)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '图片编辑失败')
    }
  }, [baseDisplaySize, cropMode, historyIndex, operations, originalSize])

  const fitImageInViewport = (size: ImageSize) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const availableWidth = Math.max(1, viewport.clientWidth - 32)
    const availableHeight = Math.max(1, viewport.clientHeight - 32)
    const scale = Math.min(
      availableWidth / size.width,
      availableHeight / size.height,
    )
    setBaseDisplaySize({
      width: size.width * scale,
      height: size.height * scale,
    })
  }

  useEffect(() => {
    if (!imageSize) return
    const frame = requestAnimationFrame(() => fitImageInViewport(imageSize))
    return () => cancelAnimationFrame(frame)
  }, [imageSize?.width, imageSize?.height])

  const centerViewport = () => {
    requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (!viewport) return
      viewport.scrollTo({
        left: Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2),
        top: Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2),
      })
    })
  }

  const resetViewAfterTransform = () => {
    zoomRef.current = 1
    setZoom(1)
    setCropMode(false)
    setCrop(undefined)
    setPreview((current) => ({ ...current, visible: false }))
    centerViewport()
  }

  const commitOperation = (operation: ImageEditOperation) => {
    const nextOperations = [...operations.slice(0, historyIndex), operation]
    setOperations(nextOperations)
    setHistoryIndex(nextOperations.length)
  }

  const updatePreview = (
    event: Pick<
      PointerEvent<HTMLCanvasElement>,
      'clientX' | 'clientY' | 'pointerType'
    >,
  ) => {
    lastPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
    }
    const canvas = canvasRef.current
    if (
      !canvas ||
      cropMode ||
      event.pointerType === 'touch' ||
      submitting
    ) {
      setPreview((current) => ({ ...current, visible: false }))
      return
    }
    const rect = canvas.getBoundingClientRect()
    setPreview({
      visible: isInsideCanvas(canvas, event.clientX, event.clientY),
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })
  }

  const finishStroke = (pointerId: number) => {
    if (activePointerRef.current !== pointerId) return
    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId)
    }
    const stroke = currentStrokeRef.current
    if (stroke) commitOperation({ type: 'stroke', stroke })
    activePointerRef.current = null
    currentStrokeRef.current = null
    drawingRef.current = false
  }

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (
      submitting ||
      cropMode ||
      loadError ||
      activePointerRef.current !== null ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return
    }
    const canvas = canvasRef.current
    if (!canvas || !baseDisplaySize || !imageSize) return
    event.preventDefault()
    canvas.setPointerCapture(event.pointerId)
    activePointerRef.current = event.pointerId
    drawingRef.current = true
    const stroke: DrawStroke = {
      color,
      width: brushSize * (imageSize.width / baseDisplaySize.width),
      points: [getCanvasPoint(canvas, event.clientX, event.clientY)],
    }
    currentStrokeRef.current = stroke
    const context = canvas.getContext('2d')
    if (!context) {
      setLoadError('无法创建图片编辑画布')
      currentStrokeRef.current = null
      finishStroke(event.pointerId)
      return
    }
    drawStroke(context, stroke)
    updatePreview(event)
  }

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    updatePreview(event)
    if (activePointerRef.current !== event.pointerId) return
    const canvas = canvasRef.current
    const stroke = currentStrokeRef.current
    if (!canvas || !stroke) return
    event.preventDefault()
    const point = getCanvasPoint(canvas, event.clientX, event.clientY)
    const previousPoint = stroke.points[stroke.points.length - 1]
    stroke.points.push(point)
    const context = canvas.getContext('2d')
    if (!context) {
      setLoadError('无法创建图片编辑画布')
      currentStrokeRef.current = null
      finishStroke(event.pointerId)
      return
    }
    drawStroke(context, { ...stroke, points: [previousPoint, point] })
  }

  const undo = () => {
    if (submitting || activePointerRef.current !== null) return
    setCropMode(false)
    setCrop(undefined)
    setHistoryIndex((current) => Math.max(0, current - 1))
  }

  const redo = () => {
    if (submitting || activePointerRef.current !== null) return
    setCropMode(false)
    setCrop(undefined)
    setHistoryIndex((current) => Math.min(operations.length, current + 1))
  }

  const resetEdits = () => {
    if (submitting || activePointerRef.current !== null) return
    setOperations([])
    setHistoryIndex(0)
    resetViewAfterTransform()
  }

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [historyIndex, open, operations.length, submitting])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleWheel = (event: WheelEvent) => {
      if (
        submitting ||
        cropMode ||
        drawingRef.current ||
        !isInsideCanvas(canvas, event.clientX, event.clientY)
      ) {
        return
      }
      event.preventDefault()
      const currentZoom = zoomRef.current
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, currentZoom * Math.exp(-event.deltaY * 0.0015)),
      )
      if (Math.abs(nextZoom - currentZoom) < 0.0001) return
      const oldRect = canvas.getBoundingClientRect()
      const u = (event.clientX - oldRect.left) / oldRect.width
      const v = (event.clientY - oldRect.top) / oldRect.height
      const clientX = event.clientX
      const clientY = event.clientY
      zoomRef.current = nextZoom
      setZoom(nextZoom)
      if (zoomFrameRef.current !== null) {
        cancelAnimationFrame(zoomFrameRef.current)
      }
      zoomFrameRef.current = requestAnimationFrame(() => {
        const viewport = viewportRef.current
        const newRect = canvas.getBoundingClientRect()
        if (viewport) {
          viewport.scrollLeft += newRect.left + u * newRect.width - clientX
          viewport.scrollTop += newRect.top + v * newRect.height - clientY
        }
        const pointer = lastPointerRef.current
        if (pointer) updatePreview(pointer)
        zoomFrameRef.current = null
      })
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [baseDisplaySize, cropMode, submitting])

  const restoreZoom = () => {
    if (submitting || cropMode) return
    zoomRef.current = 1
    setZoom(1)
    centerViewport()
  }

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const naturalWidth = event.currentTarget.naturalWidth
    const naturalHeight = event.currentTarget.naturalHeight
    if (!naturalWidth || !naturalHeight) {
      setLoadError('图片加载失败')
      setLoading(false)
      return
    }
    const nextSize = { width: naturalWidth, height: naturalHeight }
    setOriginalSize(nextSize)
    fitImageInViewport(nextSize)
    setLoading(false)
  }

  const handleImageError = () => {
    setLoadError('图片加载失败')
    setLoading(false)
  }

  const applyTransform = (
    operation:
      | Extract<ImageEditOperation, { type: 'rotate' }>
      | Extract<ImageEditOperation, { type: 'flip' }>,
  ) => {
    if (submitting || !imageSize || activePointerRef.current !== null) return
    commitOperation(operation)
    resetViewAfterTransform()
  }

  const startCrop = () => {
    if (submitting || !displaySize || activePointerRef.current !== null) return
    setCrop({
      unit: 'px',
      x: 0,
      y: 0,
      width: displaySize.width,
      height: displaySize.height,
    })
    setCropMode(true)
    setPreview((current) => ({ ...current, visible: false }))
  }

  const cancelCrop = () => {
    if (submitting) return
    setCropMode(false)
    setCrop(undefined)
  }

  const applyCurrentCrop = () => {
    if (!cropMode || !crop || !displaySize || !imageSize || submitting) return
    const scaleX = imageSize.width / displaySize.width
    const scaleY = imageSize.height / displaySize.height
    const rectangle = {
      x: Math.max(0, Math.round(crop.x * scaleX)),
      y: Math.max(0, Math.round(crop.y * scaleY)),
      width: Math.max(1, Math.round(crop.width * scaleX)),
      height: Math.max(1, Math.round(crop.height * scaleY)),
    }
    const isFullImage =
      rectangle.x === 0 &&
      rectangle.y === 0 &&
      rectangle.width >= imageSize.width &&
      rectangle.height >= imageSize.height
    if (!isFullImage) {
      commitOperation({ type: 'crop', rectangle })
    }
    resetViewAfterTransform()
  }

  const handleSubmit = async (action: SubmitAction) => {
    const image = imageRef.current
    if (
      !image ||
      historyIndex === 0 ||
      cropMode ||
      activePointerRef.current !== null
    ) {
      return
    }
    setSubmittingAction(action)
    setPreview((current) => ({ ...current, visible: false }))
    try {
      const dataUrl = await exportEditedImage(image, currentOperations)
      await (action === 'copy' ? onConfirmCopy : onConfirm)(dataUrl)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片编辑失败')
    } finally {
      setSubmittingAction(null)
    }
  }

  const displaySize = baseDisplaySize
    ? {
        width: baseDisplaySize.width * zoom,
        height: baseDisplaySize.height * zoom,
      }
    : null

  return {
    modal: {
      submitting,
      submittingAction,
      canConfirm: !!imageSize && !loadError && historyIndex > 0 && !cropMode,
      onConfirm: () => handleSubmit('replace'),
      onConfirmCopy: () => handleSubmit('copy'),
    },
    drawToolbarProps: {
      color,
      brushSize,
      zoom,
      submitting,
      zoomDisabled: cropMode,
      canUndo: historyIndex > 0,
      canRedo: historyIndex < operations.length,
      canReset: historyIndex > 0,
      onColorChange: setColor,
      onBrushSizeChange: setBrushSize,
      onRestoreZoom: restoreZoom,
      onUndo: undo,
      onRedo: redo,
      onReset: resetEdits,
    },
    transformToolbarProps: {
      disabled: submitting || !imageSize,
      cropMode,
      canApplyCrop: !!crop && crop.width > 0 && crop.height > 0,
      onRotateLeft: () =>
        applyTransform({ type: 'rotate', direction: 'left' }),
      onRotateRight: () =>
        applyTransform({ type: 'rotate', direction: 'right' }),
      onFlipHorizontal: () =>
        applyTransform({ type: 'flip', axis: 'horizontal' }),
      onFlipVertical: () =>
        applyTransform({ type: 'flip', axis: 'vertical' }),
      onStartCrop: startCrop,
      onCancelCrop: cancelCrop,
      onApplyCrop: applyCurrentCrop,
    },
    viewportProps: {
      viewportRef,
      imageRef,
      canvasRef,
      objectUrl,
      imageSize,
      displaySize,
      preview,
      color,
      brushSize,
      zoom,
      cropMode,
      crop,
      submitting,
      loading,
      loadError,
      onImageLoad: handleImageLoad,
      onImageError: handleImageError,
      onCropChange: setCrop,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerFinish: finishStroke,
      onPointerEnter: updatePreview,
      onPointerLeave: () =>
        setPreview((current) => ({ ...current, visible: false })),
    },
  }
}
