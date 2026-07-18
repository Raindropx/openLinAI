function imageBlobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

function imageBlobToJpegDataUrl(blob: Blob, quality = 0.92) {
  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        if (!context) throw new Error('浏览器无法转换图片')

        // JPEG 不支持透明通道，使用白色背景避免透明区域变黑。
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0)
        resolve(canvas.toDataURL('image/jpeg', quality))
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

/** WebP 先转 JPEG；FFmpeg 可直接处理的其他格式保持原始字节。 */
export function imageBlobToUploadDataUrl(blob: Blob) {
  const mimeType = blob.type.split(';', 1)[0].trim().toLowerCase()
  return mimeType === 'image/webp'
    ? imageBlobToJpegDataUrl(blob)
    : imageBlobToDataUrl(blob)
}
