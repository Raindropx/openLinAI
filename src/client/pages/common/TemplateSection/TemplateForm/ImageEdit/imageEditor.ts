export interface DrawPoint {
  x: number
  y: number
}

export interface DrawStroke {
  color: string
  width: number
  points: DrawPoint[]
}

export interface CropRectangle {
  x: number
  y: number
  width: number
  height: number
}

export type ImageEditOperation =
  | { type: 'stroke'; stroke: DrawStroke }
  | { type: 'rotate'; direction: 'left' | 'right' }
  | { type: 'flip'; axis: 'horizontal' | 'vertical' }
  | { type: 'crop'; rectangle: CropRectangle }

export interface ImageSize {
  width: number
  height: number
}

export function getCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): DrawPoint {
  const rect = canvas.getBoundingClientRect()
  return {
    x: Math.max(
      0,
      Math.min(
        canvas.width,
        (clientX - rect.left) * (canvas.width / rect.width),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        canvas.height,
        (clientY - rect.top) * (canvas.height / rect.height),
      ),
    ),
  }
}

export function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: DrawStroke,
) {
  const firstPoint = stroke.points[0]
  if (!firstPoint) return
  context.save()
  context.strokeStyle = stroke.color
  context.fillStyle = stroke.color
  context.lineWidth = stroke.width
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (stroke.points.length === 1) {
    context.beginPath()
    context.arc(firstPoint.x, firstPoint.y, stroke.width / 2, 0, Math.PI * 2)
    context.fill()
  } else {
    context.beginPath()
    context.moveTo(firstPoint.x, firstPoint.y)
    for (let index = 1; index < stroke.points.length; index += 1) {
      const point = stroke.points[index]
      context.lineTo(point.x, point.y)
    }
    context.stroke()
  }
  context.restore()
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function getContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片编辑画布')
  return context
}

function applyRotate(
  source: HTMLCanvasElement,
  direction: 'left' | 'right',
) {
  const result = createCanvas(source.height, source.width)
  const context = getContext(result)
  context.save()
  if (direction === 'right') {
    context.translate(result.width, 0)
    context.rotate(Math.PI / 2)
  } else {
    context.translate(0, result.height)
    context.rotate(-Math.PI / 2)
  }
  context.drawImage(source, 0, 0)
  context.restore()
  return result
}

function applyFlip(
  source: HTMLCanvasElement,
  axis: 'horizontal' | 'vertical',
) {
  const result = createCanvas(source.width, source.height)
  const context = getContext(result)
  context.save()
  if (axis === 'horizontal') {
    context.translate(result.width, 0)
    context.scale(-1, 1)
  } else {
    context.translate(0, result.height)
    context.scale(1, -1)
  }
  context.drawImage(source, 0, 0)
  context.restore()
  return result
}

function applyCrop(source: HTMLCanvasElement, rectangle: CropRectangle) {
  const x = Math.max(0, Math.min(source.width - 1, Math.round(rectangle.x)))
  const y = Math.max(0, Math.min(source.height - 1, Math.round(rectangle.y)))
  const width = Math.max(
    1,
    Math.min(source.width - x, Math.round(rectangle.width)),
  )
  const height = Math.max(
    1,
    Math.min(source.height - y, Math.round(rectangle.height)),
  )
  const result = createCanvas(width, height)
  getContext(result).drawImage(source, -x, -y)
  return result
}

export function getEditedImageSize(
  originalSize: ImageSize,
  operations: ImageEditOperation[],
) {
  let size = { ...originalSize }
  for (const operation of operations) {
    if (operation.type === 'rotate') {
      size = { width: size.height, height: size.width }
    } else if (operation.type === 'crop') {
      const x = Math.max(
        0,
        Math.min(size.width - 1, Math.round(operation.rectangle.x)),
      )
      const y = Math.max(
        0,
        Math.min(size.height - 1, Math.round(operation.rectangle.y)),
      )
      size = {
        width: Math.max(
          1,
          Math.min(size.width - x, Math.round(operation.rectangle.width)),
        ),
        height: Math.max(
          1,
          Math.min(size.height - y, Math.round(operation.rectangle.height)),
        ),
      }
    }
  }
  return size
}

export function renderEditedImage(
  image: HTMLImageElement,
  operations: ImageEditOperation[],
  target: HTMLCanvasElement,
) {
  let workingCanvas = createCanvas(image.naturalWidth, image.naturalHeight)
  getContext(workingCanvas).drawImage(
    image,
    0,
    0,
    workingCanvas.width,
    workingCanvas.height,
  )

  for (const operation of operations) {
    if (operation.type === 'stroke') {
      drawStroke(getContext(workingCanvas), operation.stroke)
    } else if (operation.type === 'rotate') {
      workingCanvas = applyRotate(workingCanvas, operation.direction)
    } else if (operation.type === 'flip') {
      workingCanvas = applyFlip(workingCanvas, operation.axis)
    } else {
      workingCanvas = applyCrop(workingCanvas, operation.rectangle)
    }
  }

  target.width = workingCanvas.width
  target.height = workingCanvas.height
  getContext(target).drawImage(workingCanvas, 0, 0)
}

function canvasToDataUrl(canvas: HTMLCanvasElement) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('图片编辑导出失败'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('编辑结果读取失败'))
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

export async function exportEditedImage(
  image: HTMLImageElement,
  operations: ImageEditOperation[],
) {
  const canvas = document.createElement('canvas')
  renderEditedImage(image, operations, canvas)
  return canvasToDataUrl(canvas)
}
