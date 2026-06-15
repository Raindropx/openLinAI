import { hc } from 'hono/client'
import type { AppType } from '../../../../server'
import type {
  MediaDecisionStatus,
  MediaImageItem,
  MediaImageListResult,
  MediaImageStage,
  MediaWorkspaceSnapshot,
} from './types'

const client = hc<AppType>('/')

type ApiResponse<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error?: string
    }

const unwrapResponse = async <T>(response: Response) => {
  const json = (await response.json()) as ApiResponse<T>
  if (!json.success) {
    throw new Error(json.error || '请求失败')
  }

  return json.data
}

export const getMediaWorkspace = async () =>
  unwrapResponse<MediaWorkspaceSnapshot>(
    await client.api['media-classifier'].workspace.$get(),
  )

export const saveMediaWorkspace = async (
  sourceDir: string,
  resultDir: string,
) =>
  unwrapResponse<MediaWorkspaceSnapshot>(
    await client.api['media-classifier'].workspace.$post({
      json: {
        sourceDir,
        resultDir,
      },
    }),
  )

export const getMediaImages = async (
  stage: MediaImageStage,
  page: number,
  pageSize: number,
) =>
  unwrapResponse<MediaImageListResult>(
    await client.api['media-classifier'].images.$get({
      query: {
        stage,
        page: String(page),
        pageSize: String(pageSize),
      },
    }),
  )

export const getAllMediaImages = async (stage: MediaImageStage) =>
  unwrapResponse<MediaImageItem[]>(
    await client.api['media-classifier'].images.all.$get({
      query: { stage },
    }),
  )

export const markMediaImage = async (
  relativePath: string,
  status: MediaDecisionStatus,
) =>
  unwrapResponse<MediaImageItem>(
    await client.api['media-classifier'].images.mark.$post({
      json: {
        relativePath,
        status,
      },
    }),
  )

export const restoreMediaImage = async (relativePath: string) =>
  unwrapResponse<MediaImageItem>(
    await client.api['media-classifier'].trash.restore.$post({
      json: {
        relativePath,
      },
    }),
  )

export const deleteMediaImagePermanently = async (relativePath: string) =>
  unwrapResponse<MediaWorkspaceSnapshot>(
    await client.api['media-classifier'].trash.delete.$post({
      json: {
        relativePath,
      },
    }),
  )
