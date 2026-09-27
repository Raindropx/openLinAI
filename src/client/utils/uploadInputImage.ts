import { hc } from 'hono/client'
import type { AppType } from '../../server'
import { t } from '../i18n'
import { imageBlobToUploadDataUrl } from './image'

const client = hc<AppType>('/')

export async function uploadInputImageBase64(
  base64: string,
  options?: { maxDimension?: number },
) {
  const response = await client.api.static.images.upload.$post({
    json: { image: base64, maxDimension: options?.maxDimension },
  })
  const data = await response.json()

  if (!data.success || !('url' in data)) {
    throw new Error((data as { error?: string }).error || t('图片上传失败'))
  }

  return data.url as string
}

export async function uploadInputImageFromUrl(
  url: string,
  options?: { maxDimension?: number },
) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(t('图片下载失败'))
  }

  const uploadDataUrl = await imageBlobToUploadDataUrl(await response.blob())
  return uploadInputImageBase64(uploadDataUrl, options)
}
