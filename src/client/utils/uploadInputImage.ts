import { hc } from 'hono/client'
import type { AppType } from '../../server'
import { imageBlobToUploadDataUrl } from './image'

const client = hc<AppType>('/')

export async function uploadInputImageBase64(base64: string) {
  const response = await client.api.static.images.upload.$post({
    json: { image: base64 },
  })
  const data = await response.json()

  if (!data.success || !('url' in data)) {
    throw new Error((data as { error?: string }).error || '图片上传失败')
  }

  return data.url as string
}

export async function uploadInputImageFromUrl(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('图片下载失败')
  }

  const uploadDataUrl = await imageBlobToUploadDataUrl(await response.blob())
  return uploadInputImageBase64(uploadDataUrl)
}
