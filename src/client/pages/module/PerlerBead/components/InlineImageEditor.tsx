import { BorderOutlined, DragOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { useRef, useState, type PointerEvent } from 'react'
import { t } from '../../../../i18n'
import { ImageDrawToolbar } from '../../../common/TemplateSection/TemplateForm/ImageEdit/ImageDrawToolbar'
import { ImageEditorViewport } from '../../../common/TemplateSection/TemplateForm/ImageEdit/ImageEditorViewport'
import { ImageTransformToolbar } from '../../../common/TemplateSection/TemplateForm/ImageEdit/ImageTransformToolbar'
import { useImageEditor } from '../../../common/TemplateSection/TemplateForm/ImageEdit/useImageEditor'
import type { GridSize } from '../types'
import { getImageDataFromImage } from '../processing'
import { SourceImageActions } from './SourceImageActions'

interface InlineImageEditorProps {
  src: string
  originalImage: HTMLImageElement
  initialPalette: readonly string[] | null
  grid: GridSize
  offsetX: number
  offsetY: number
  presetColors: string[]
  onPreview: (canvas: HTMLCanvasElement, hasEdits: boolean, palette: readonly string[] | null) => void
  onConfirm: (dataUrl: string, palette?: readonly string[] | null) => Promise<void>
  onCancel: () => void
}

export function InlineImageEditor({ src, originalImage, initialPalette, grid, offsetX, offsetY, presetColors, onPreview, onConfirm, onCancel }: InlineImageEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const editor = useImageEditor({ open: true, src, onConfirm, onConfirmCopy: onConfirm, onPreview, initialPalette, keyboardScope: rootRef })
  const [showGrid, setShowGrid] = useState(true)
  const [panMode, setPanMode] = useState(false)
  const [comparing, setComparing] = useState(false)
  const panRef = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const viewport = editor.viewportProps
  const disabled = editor.modal.submitting || viewport.loading || !!viewport.loadError

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (comparing) return
    event.currentTarget.focus({ preventScroll: true })
    if (panRef.current || (event.button !== 0 && event.button !== 1)) return
    const container = viewport.viewportRef.current
    if ((panMode || event.button === 1) && !disabled && container) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      panRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: container.scrollLeft, top: container.scrollTop }
    } else viewport.onPointerDown(event)
  }
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (comparing) return
    const pan = panRef.current
    const container = viewport.viewportRef.current
    if (pan && pan.id === event.pointerId && container) {
      container.scrollLeft = pan.left + pan.x - event.clientX
      container.scrollTop = pan.top + pan.y - event.clientY
    } else if (!panMode) viewport.onPointerMove(event)
  }
  const onPointerFinish = (id: number) => {
    if (panRef.current?.id === id) {
      panRef.current = null
      const canvas = viewport.canvasRef.current
      if (canvas?.hasPointerCapture(id)) canvas.releasePointerCapture(id)
    } else viewport.onPointerFinish(id)
  }
  const size = viewport.imageSize
  const overlay = showGrid && size && (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${size.width} ${size.height}`}>
      <g stroke="rgba(255,255,255,0.45)" strokeWidth="1">
        {Array.from({ length: grid.columns + 3 }, (_, i) => {
          const x = (i - 1 + offsetX - 0.5) * size.width / grid.columns
          return <line key={`x${i}`} x1={x} x2={x} y1={0} y2={size.height} vectorEffect="non-scaling-stroke" />
        })}
        {Array.from({ length: grid.rows + 3 }, (_, i) => {
          const y = (i - 1 + offsetY - 0.5) * size.height / grid.rows
          return <line key={`y${i}`} x1={0} x2={size.width} y1={y} y2={y} vectorEffect="non-scaling-stroke" />
        })}
      </g>
    </svg>
  )

  return (
    <div ref={rootRef} className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-1 border-b border-slate-200 px-3 py-1 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('编辑原图')}</span>
          <span className="text-xs text-slate-400">{grid.columns} × {grid.rows}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip title={showGrid ? t('隐藏网格线') : t('显示网格线')}>
            <Button size="small" type={showGrid ? 'primary' : 'text'} ghost={showGrid} aria-label={t('显示网格线')} aria-pressed={showGrid} icon={<BorderOutlined />} onClick={() => setShowGrid(!showGrid)} />
          </Tooltip>
          <Tooltip title={t('拖拽平移')}>
            <Button size="small" type={panMode ? 'primary' : 'text'} aria-label={t('拖拽平移')} aria-pressed={panMode} disabled={disabled || viewport.cropMode} icon={<DragOutlined />} onClick={() => setPanMode(!panMode)} />
          </Tooltip>
          <Button size="small" disabled={editor.modal.submitting} onClick={onCancel}>{t('取消')}</Button>
          <Button size="small" type="primary" loading={editor.modal.submitting} disabled={!editor.modal.canConfirm || disabled || comparing} onClick={editor.modal.onConfirm}>{t('应用编辑')}</Button>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <SourceImageActions disabled={disabled || viewport.cropMode} comparing={comparing} onCompare={setComparing}
          onRestore={() => editor.applySnapshot(getImageDataFromImage(originalImage, 0).imageData)}
          getImageData={() => {
            const canvas = viewport.canvasRef.current
            const context = canvas?.getContext('2d')
            if (!canvas || !context) throw new Error(t('无法创建图片编辑画布'))
            return context.getImageData(0, 0, canvas.width, canvas.height)
          }} onReduced={editor.applySnapshot} />
      </div>
      <ImageDrawToolbar {...editor.drawToolbarProps} submitting={disabled || comparing} compact presetColors={presetColors} resetLabel={t('重置本次编辑')} />
      <ImageEditorViewport {...viewport} inline overlay={<>{overlay}{comparing && <div className="pointer-events-none absolute inset-0 z-20 bg-slate-50 dark:bg-slate-950"><img src={originalImage.src} alt={t('原图对照')} className="h-full w-full object-contain" /></div>}</>} panMode={panMode || comparing} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerFinish={onPointerFinish} />
      <ImageTransformToolbar {...editor.transformToolbarProps} disabled={disabled || comparing || editor.transformToolbarProps.disabled} compact />
      <div className="shrink-0 px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400">{t('每笔编辑后自动预览拼豆效果')}</div>
    </div>
  )
}
