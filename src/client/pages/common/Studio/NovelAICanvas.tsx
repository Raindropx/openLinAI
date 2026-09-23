import {
  ClearOutlined,
  DragOutlined,
  MinusOutlined,
  PlusOutlined,
  RedoOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { Button, Empty, Slider, Tooltip } from 'antd'
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

interface Props {
  imageUrl?: string
  name?: string
  width?: number
  height?: number
  mode?: 'view' | 'mask'
  maskDataUrl?: string
  onMaskChange?: (dataUrl?: string) => void
  generating?: boolean
  actions?: ReactNode
  emptyActions?: ReactNode
}

/** Black means keep the source image; white means regenerate it. */
export function NovelAICanvas({
  imageUrl,
  name,
  width,
  height,
  mode = 'view',
  maskDataUrl,
  onMaskChange,
  generating,
  actions,
  emptyActions,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [imageSize, setImageSize] = useState({ width: 1024, height: 1024 })
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [brush, setBrush] = useState(48)
  const [eraser, setEraser] = useState(false)
  const [hand, setHand] = useState(false)
  const [, setRevision] = useState(0)
  const history = useRef<ImageData[]>([])
  const future = useRef<ImageData[]>([])
  const pointer = useRef<{ id: number; x: number; y: number; drawing: boolean } | undefined>(undefined)
  const strokes = useRef(false)
  const lastSource = useRef('')
  const locallyExported = useRef<string | undefined>(undefined)
  const pixelWidth = width || imageSize.width
  const pixelHeight = height || imageSize.height

  const fit = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect()
    if (!rect || !pixelWidth || !pixelHeight) return
    setScale(Math.min(8, (rect.width - 32) / pixelWidth, (rect.height - 32) / pixelHeight))
    setPan({ x: 0, y: 0 })
  }, [pixelHeight, pixelWidth])

  useEffect(() => {
    fit()
    const resize = new ResizeObserver(fit)
    if (viewport.current) resize.observe(viewport.current)
    return () => resize.disconnect()
  }, [fit, imageUrl])

  useEffect(() => {
    const layer = canvas.current
    if (!layer) return
    const sourceKey = `${imageUrl}|${pixelWidth}|${pixelHeight}`
    if (lastSource.current === sourceKey && locallyExported.current === maskDataUrl) return
    lastSource.current = sourceKey
    locallyExported.current = undefined
    layer.width = pixelWidth
    layer.height = pixelHeight
    history.current = []
    future.current = []
    strokes.current = false
    setRevision((value) => value + 1)
    if (!maskDataUrl) return
    const source = new Image()
    source.onload = () => {
      if (canvas.current !== layer) return
      const context = layer.getContext('2d', { willReadFrequently: true })
      if (!context) return
      const buffer = document.createElement('canvas')
      buffer.width = pixelWidth
      buffer.height = pixelHeight
      const input = buffer.getContext('2d', { willReadFrequently: true })
      if (!input) return
      input.drawImage(source, 0, 0, pixelWidth, pixelHeight)
      const pixels = input.getImageData(0, 0, pixelWidth, pixelHeight)
      const painted = context.createImageData(pixelWidth, pixelHeight)
      let any = false
      for (let i = 0; i < pixels.data.length; i += 4) {
        const selected = pixels.data[i] > 127 && pixels.data[i + 1] > 127 && pixels.data[i + 2] > 127 && pixels.data[i + 3] > 127
        painted.data[i] = 255
        painted.data[i + 1] = 104
        painted.data[i + 2] = 92
        painted.data[i + 3] = selected ? 255 : 0
        any ||= selected
      }
      context.putImageData(painted, 0, 0)
      strokes.current = any
      setRevision((value) => value + 1)
    }
    source.src = maskDataUrl
  }, [maskDataUrl, pixelHeight, pixelWidth, imageUrl])

  function saveHistory() {
    const layer = canvas.current
    const context = layer?.getContext('2d', { willReadFrequently: true })
    if (!layer || !context) return
    history.current.push(context.getImageData(0, 0, layer.width, layer.height))
    if (history.current.length > 8) history.current.shift()
    future.current = []
    setRevision((value) => value + 1)
  }

  function exportMask() {
    const layer = canvas.current
    const context = layer?.getContext('2d', { willReadFrequently: true })
    if (!layer || !context) return
    const source = context.getImageData(0, 0, layer.width, layer.height)
    const out = document.createElement('canvas')
    out.width = layer.width
    out.height = layer.height
    const output = out.getContext('2d')
    if (!output) return
    const pixels = output.createImageData(out.width, out.height)
    let any = false
    for (let i = 0; i < pixels.data.length; i += 4) {
      const level = source.data[i + 3] > 0 ? 255 : 0
      any ||= level > 0
      pixels.data[i] = level
      pixels.data[i + 1] = level
      pixels.data[i + 2] = level
      pixels.data[i + 3] = 255
    }
    output.putImageData(pixels, 0, 0)
    strokes.current = any
    const result = any ? out.toDataURL('image/png') : undefined
    locallyExported.current = result
    onMaskChange?.(result)
  }

  function restore(undo: boolean) {
    const layer = canvas.current
    const context = layer?.getContext('2d', { willReadFrequently: true })
    const from = undo ? history.current : future.current
    const to = undo ? future.current : history.current
    if (!layer || !context || !from.length) return
    to.push(context.getImageData(0, 0, layer.width, layer.height))
    context.putImageData(from.pop()!, 0, 0)
    strokes.current = context.getImageData(0, 0, layer.width, layer.height).data.some((value, i) => i % 4 === 3 && value > 0)
    setRevision((value) => value + 1)
    exportMask()
  }

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * pixelWidth,
      y: ((event.clientY - rect.top) / rect.height) * pixelHeight,
    }
  }

  function paint(x: number, y: number, previous?: { x: number; y: number }) {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    context.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    context.strokeStyle = '#ff685c'
    context.fillStyle = '#ff685c'
    context.lineWidth = brush
    context.lineCap = 'round'
    context.lineJoin = 'round'
    if (previous) {
      context.beginPath()
      context.moveTo(previous.x, previous.y)
      context.lineTo(x, y)
      context.stroke()
    } else {
      context.beginPath()
      context.arc(x, y, brush / 2, 0, Math.PI * 2)
      context.fill()
    }
    strokes.current = true
  }

  return (
    <section className="novelai-canvas">
      <header className="novelai-canvas-toolbar">
        <strong>{name || '创作画布'}</strong>
        <div className="novelai-canvas-actions">{actions}</div>
      </header>
      {imageUrl ? (
        <>
          <div className="novelai-canvas-viewport" ref={viewport}>
            <div
              className="novelai-canvas-art"
              style={{
                width: pixelWidth * scale,
                height: pixelHeight * scale,
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
            >
              <img
                src={imageUrl}
                alt={name || '生成图片'}
                draggable={false}
                style={{ objectFit: mode === 'mask' ? 'cover' : 'fill' }}
                onLoad={(event) => {
                  const image = event.currentTarget
                  setImageSize({ width: image.naturalWidth, height: image.naturalHeight })
                }}
              />
              <canvas
                ref={canvas}
                className={mode === 'mask' && !hand ? 'is-painting' : ''}
                style={{ opacity: mode === 'mask' ? 0.55 : 0, touchAction: 'none' }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  const position = point(event)
                  pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, drawing: mode === 'mask' && !hand }
                  if (pointer.current.drawing) {
                    saveHistory()
                    paint(position.x, position.y)
                  }
                }}
                onPointerMove={(event) => {
                  const previous = pointer.current
                  if (!previous || previous.id !== event.pointerId) return
                  if (previous.drawing) {
                    const position = point(event)
                    const prior = {
                      x: ((previous.x - event.currentTarget.getBoundingClientRect().left) / event.currentTarget.getBoundingClientRect().width) * pixelWidth,
                      y: ((previous.y - event.currentTarget.getBoundingClientRect().top) / event.currentTarget.getBoundingClientRect().height) * pixelHeight,
                    }
                    paint(position.x, position.y, prior)
                  } else setPan((value) => ({ x: value.x + event.clientX - previous.x, y: value.y + event.clientY - previous.y }))
                  pointer.current = { ...previous, x: event.clientX, y: event.clientY }
                }}
                onPointerUp={(event) => {
                  if (pointer.current?.id === event.pointerId) {
                    if (pointer.current.drawing) exportMask()
                    pointer.current = undefined
                  }
                }}
              />
            </div>
            {generating && <div className="novelai-canvas-generating">正在生成…</div>}
          </div>
          <footer className="novelai-canvas-footer">
            <span>{pixelWidth} × {pixelHeight}</span>
            {mode === 'mask' && (
              <div className="novelai-mask-tools">
                <Tooltip title="移动画布"><Button size="small" type={hand ? 'primary' : 'default'} icon={<DragOutlined />} onClick={() => setHand(!hand)} /></Tooltip>
                <Button size="small" type={!eraser && !hand ? 'primary' : 'default'} onClick={() => { setEraser(false); setHand(false) }}>画笔</Button>
                <Button size="small" type={eraser && !hand ? 'primary' : 'default'} onClick={() => { setEraser(true); setHand(false) }}>橡皮</Button>
                <Slider min={4} max={240} value={brush} onChange={setBrush} style={{ width: 86 }} aria-label="遮罩画笔大小" />
                <Button size="small" icon={<UndoOutlined />} disabled={!history.current.length} onClick={() => restore(true)} aria-label="撤销遮罩" />
                <Button size="small" icon={<RedoOutlined />} disabled={!future.current.length} onClick={() => restore(false)} aria-label="重做遮罩" />
                <Button size="small" icon={<ClearOutlined />} onClick={() => { saveHistory(); canvas.current?.getContext('2d')?.clearRect(0, 0, pixelWidth, pixelHeight); strokes.current = false; locallyExported.current = undefined; onMaskChange?.(undefined) }}>清空遮罩</Button>
                <span className="novelai-mask-hint">红色区域将重绘</span>
              </div>
            )}
            <div className="novelai-zoom-tools">
              <Button size="small" icon={<MinusOutlined />} onClick={() => setScale((value) => Math.max(0.05, value / 1.2))} aria-label="缩小" />
              <Button size="small" onClick={fit}>适应</Button>
              <span>{Math.round(scale * 100)}%</span>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setScale((value) => Math.min(16, value * 1.2))} aria-label="放大" />
            </div>
          </footer>
        </>
      ) : (
        <div className="novelai-canvas-empty" ref={viewport}>
          <Empty description="生成结果会在这里显示，也可以从右侧暂存台选图" />
          {emptyActions}
          {generating && <div className="novelai-canvas-generating">正在生成…</div>}
        </div>
      )}
    </section>
  )
}
