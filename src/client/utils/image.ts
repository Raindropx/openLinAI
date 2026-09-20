function imageBlobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

const MAX_RASTER_DIMENSION = 4096
const MAX_RASTER_PIXELS = 40_000_000

function calculateRasterSize(width: number, height: number) {
  if (!width || !height) throw new Error('无法识别图片尺寸')
  const scale = Math.min(
    1,
    MAX_RASTER_DIMENSION / width,
    MAX_RASTER_DIMENSION / height,
    Math.sqrt(MAX_RASTER_PIXELS / (width * height)),
  )
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function imageBlobToRasterDataUrl(blob: Blob, mimeType = 'image/png') {
  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      try {
        const size = calculateRasterSize(image.naturalWidth, image.naturalHeight)
        const canvas = document.createElement('canvas')
        canvas.width = size.width
        canvas.height = size.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('浏览器无法转换图片')

        if (mimeType === 'image/jpeg') {
          // JPEG 不支持透明通道，使用白色背景避免透明区域变黑。
          context.fillStyle = '#fff'
          context.fillRect(0, 0, canvas.width, canvas.height)
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL(mimeType, 0.92))
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('浏览器无法读取该图片'))
    }

    image.src = objectUrl
  })
}

/**
 * 上传链路直接保留 PNG/JPEG。其他格式先由浏览器渲染为单帧 PNG：
 * 这会在 SVG 成为参考图前消除矢量内容，也避免将 NovelAI 不支持的格式原样透传。
 */
export function imageBlobToUploadDataUrl(blob: Blob) {
  const mimeType = blob.type.split(';', 1)[0].trim().toLowerCase()
  return mimeType === 'image/png' || mimeType === 'image/jpeg'
    ? imageBlobToDataUrl(blob)
    : imageBlobToRasterDataUrl(blob)
}
