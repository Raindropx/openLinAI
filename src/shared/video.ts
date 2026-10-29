import { z } from 'zod'

export type VideoGenerationStatus =
  | 'queued'
  | 'submitting'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
export type VideoRetrievalStatus =
  | 'not_retrieved'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'retrieved'
  | 'failed'
  | 'cancelled'

export interface VideoRequest {
  provider: string
  model: string
  generationType: 'text_to_video' | 'image_to_video' | 'reference_to_video'
  prompt: string
  inputImages: string[]
  durationSeconds: number
  resolution: string
  aspectRatio: string
  references?: VideoReference[]
  frameMode?: 'first_frame' | 'first_last_frame'
  frames?: { firstImageUrl: string; lastImageUrl?: string }
}

export type VideoReference =
  | { type: 'image'; imageUrl: string }
  | { type: 'video' | 'audio'; remoteUrl: string }

export interface VideoResult {
  remoteUrl?: string
  remoteUrlExpiresAt?: number
  localFileId?: string
  mimeType?: 'video/mp4' | 'video/webm'
  fileSize?: number
  savedAt?: number
  durationSeconds?: number
  width?: number
  height?: number
  posterUrl?: string
}

export interface VideoTask {
  request: VideoRequest
  generationStatus: VideoGenerationStatus
  remoteTaskId?: string
  retrievalStatus: VideoRetrievalStatus
  retrievalBytes: number
  retrievalTotalBytes?: number
  retrievalError?: string
  /** Durable, verified prefix of the .part file; never restored from a backup. */
  retrievalCheckpoint?: VideoRetrievalCheckpoint
  retrievalCommit?: {
    bytes: number
    sha256: string
    mimeType: 'video/mp4' | 'video/webm'
  }
  retrievalNotice?: string
  error?: string
  pollFailures?: number
  nextPollAt?: number
  generationDeadlineAt?: number
  result?: VideoResult
}

export interface VideoRetrievalCheckpoint {
  bytes: number
  totalBytes: number
  etag: string
  urlHash: string
  sha256: string
  mimeType: 'video/mp4' | 'video/webm'
}

export interface VideoCapabilities {
  provider: string
  label: string
  mock?: boolean
  models: string[]
  generationTypes: VideoRequest['generationType'][]
  maxImages: number
  maxPromptLength: number
  durations: number[]
  resolutions: string[]
  aspectRatios: string[]
  references?: {
    maxImages: number
    maxVideos: number
    maxAudio: number
    maxTotalFiles: number
  }
  nativeAudio?: boolean
  frameModes?: Array<'first_frame' | 'first_last_frame'>
}

export const videoRequestSchema = z
  .object({
    provider: z.string().min(1).max(80),
    model: z.string().min(1).max(200),
    generationType: z.enum([
      'text_to_video',
      'image_to_video',
      'reference_to_video',
    ]),
    prompt: z.string().trim().min(1).max(20000),
    inputImages: z.array(z.string().max(1000)).max(16).default([]),
    durationSeconds: z.number().int().positive().max(600),
    resolution: z.string().max(40),
    aspectRatio: z.string().max(40),
    references: z
      .array(
        z.union([
          z
            .object({
              type: z.literal('image'),
              imageUrl: z.string().max(1000),
            })
            .strict(),
          z
            .object({
              type: z.enum(['video', 'audio']),
              remoteUrl: z.string().max(16000),
            })
            .strict(),
        ]),
      )
      .max(24)
      .optional(),
    frameMode: z.enum(['first_frame', 'first_last_frame']).optional(),
    frames: z
      .object({
        firstImageUrl: z.string().max(1000),
        lastImageUrl: z.string().max(1000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export function videoModeLabel(mode: VideoRequest['generationType']) {
  return mode === 'text_to_video'
    ? '文生视频'
    : mode === 'image_to_video'
      ? '图生视频'
      : '参考生成'
}

export const videoTaskSchema = z.object({
  request: videoRequestSchema,
  generationStatus: z.enum([
    'queued',
    'submitting',
    'processing',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  retrievalStatus: z.enum([
    'not_retrieved',
    'queued',
    'downloading',
    'paused',
    'retrieved',
    'failed',
    'cancelled',
  ]),
  retrievalBytes: z.number().finite().nonnegative(),
  retrievalTotalBytes: z.number().finite().nonnegative().optional(),
  remoteTaskId: z.string().min(1).max(500).optional(),
  retrievalError: z.string().max(2000).optional(),
  retrievalNotice: z.string().max(2000).optional(),
  retrievalCommit: z
    .object({
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      mimeType: z.enum(['video/mp4', 'video/webm']),
    })
    .optional(),
  retrievalCheckpoint: z
    .object({
      bytes: z.number().int().positive(),
      totalBytes: z.number().int().positive(),
      etag: z.string().max(1000),
      urlHash: z.string().regex(/^[a-f0-9]{64}$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      mimeType: z.enum(['video/mp4', 'video/webm']),
    })
    .optional(),
  error: z.string().max(2000).optional(),
  pollFailures: z.number().int().nonnegative().optional(),
  nextPollAt: z.number().finite().optional(),
  generationDeadlineAt: z.number().finite().optional(),
  result: z
    .object({
      remoteUrl: z.string().max(16000).optional(),
      remoteUrlExpiresAt: z.number().finite().optional(),
      localFileId: z.string().uuid().optional(),
      mimeType: z.enum(['video/mp4', 'video/webm']).optional(),
      fileSize: z.number().finite().nonnegative().optional(),
      savedAt: z.number().finite().optional(),
      durationSeconds: z.number().finite().positive().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      posterUrl: z.string().max(16000).optional(),
    })
    .optional(),
})

export interface VideoSources {
  playbackUrl?: string
  downloadUrl?: string
  source?: 'local' | 'cloud'
  error?: string
}

export const VIDEO_GENERATION_LABELS: Record<VideoGenerationStatus, string> = {
  queued: '等待提交',
  submitting: '提交中',
  processing: '云端生成中',
  succeeded: '生成成功',
  failed: '生成失败',
  cancelled: '已取消',
}
export const VIDEO_RETRIEVAL_LABELS: Record<VideoRetrievalStatus, string> = {
  not_retrieved: '未取回',
  queued: '等待取回',
  downloading: '取回中',
  paused: '取回已暂停',
  retrieved: '已取回',
  failed: '取回失败',
  cancelled: '取回已取消',
}
