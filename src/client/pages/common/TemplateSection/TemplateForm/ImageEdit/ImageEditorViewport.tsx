import { Alert, Spin } from 'antd'
import type {
  CSSProperties,
  PointerEvent,
  RefObject,
  SyntheticEvent,
} from 'react'
import ReactCrop, { type PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import type { ImageSize } from './imageEditor'

export interface BrushPreview {
  visible: boolean
  x: number
  y: number
}

interface ImageEditorViewportProps {
  viewportRef: RefObject<HTMLDivElement | null>
  imageRef: RefObject<HTMLImageElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  objectUrl: string | null
  imageSize: ImageSize | null
  displaySize: ImageSize | null
  preview: BrushPreview
  color: string
  brushSize: number
  zoom: number
  cropMode: boolean
  crop: PixelCrop | undefined
  submitting: boolean
  loading: boolean
  loadError: string | null
  onImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void
  onImageError: () => void
  onCropChange: (crop: PixelCrop) => void
  onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => void
  onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => void
  onPointerFinish: (pointerId: number) => void
  onPointerEnter: (event: PointerEvent<HTMLCanvasElement>) => void
  onPointerLeave: () => void
}

export function ImageEditorViewport({
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
  onImageLoad,
  onImageError,
  onCropChange,
  onPointerDown,
  onPointerMove,
  onPointerFinish,
  onPointerEnter,
  onPointerLeave,
}: ImageEditorViewportProps) {
  const canvasStyle: CSSProperties | undefined = displaySize
    ? { width: displaySize.width, height: displaySize.height }
    : undefined

  const canvas = imageSize && displaySize && (
    <canvas
      ref={canvasRef}
      width={imageSize.width}
      height={imageSize.height}
      aria-label={cropMode ? '图片裁剪画布' : '图片涂抹画布'}
      className={
        cropMode
          ? 'block select-none'
          : 'block cursor-none touch-none select-none'
      }
      style={canvasStyle}
      onPointerDown={cropMode ? undefined : onPointerDown}
      onPointerMove={cropMode ? undefined : onPointerMove}
      onPointerUp={
        cropMode
          ? undefined
          : (event) => onPointerFinish(event.pointerId)
      }
      onPointerCancel={
        cropMode
          ? undefined
          : (event) => onPointerFinish(event.pointerId)
      }
      onPointerEnter={cropMode ? undefined : onPointerEnter}
      onPointerLeave={cropMode ? undefined : onPointerLeave}
    />
  )

  return (
    <div
      ref={viewportRef}
      className="relative h-[min(42vh,360px)] min-h-72 overflow-auto rounded-lg bg-slate-900 sm:h-[min(60vh,560px)]"
    >
      {objectUrl && (
        <img
          ref={imageRef}
          src={objectUrl}
          alt="待编辑图片"
          className="hidden"
          onLoad={onImageLoad}
          onError={onImageError}
        />
      )}
      {loadError ? (
        <div className="flex h-full min-h-72 items-center justify-center p-4">
          <Alert type="error" showIcon message={loadError} />
        </div>
      ) : canvas ? (
        <div className="flex h-max min-h-full w-max min-w-full items-center justify-center p-4">
          <div className="relative shrink-0" style={displaySize || undefined}>
            {cropMode ? (
              <ReactCrop
                crop={crop}
                keepSelection
                disabled={submitting}
                minWidth={20}
                minHeight={20}
                ruleOfThirds
                ariaLabels={{
                  cropArea: '图片裁剪区域',
                  nwDragHandle: '左上裁剪控制点',
                  nDragHandle: '上方裁剪控制点',
                  neDragHandle: '右上裁剪控制点',
                  eDragHandle: '右侧裁剪控制点',
                  seDragHandle: '右下裁剪控制点',
                  sDragHandle: '下方裁剪控制点',
                  swDragHandle: '左下裁剪控制点',
                  wDragHandle: '左侧裁剪控制点',
                }}
                onChange={onCropChange}
              >
                {canvas}
              </ReactCrop>
            ) : (
              canvas
            )}
            {!cropMode && preview.visible && (
              <span
                className="pointer-events-none absolute z-10 rounded-full border border-white shadow-[0_0_0_1px_#000]"
                style={{
                  left: preview.x,
                  top: preview.y,
                  width: brushSize * zoom,
                  height: brushSize * zoom,
                  backgroundColor: `${color}66`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            )}
          </div>
        </div>
      ) : loading ? (
        <div className="flex h-full min-h-72 items-center justify-center">
          <Spin size="large" />
        </div>
      ) : null}
      {loading && imageSize && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60">
          <Spin size="large" />
        </div>
      )}
    </div>
  )
}
