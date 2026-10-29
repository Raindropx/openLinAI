import type {
  VideoCapabilities,
  VideoGenerationStatus,
  VideoRequest,
  VideoResult,
} from '../../../shared/video'
export { videoRequestSchema } from '../../../shared/video'

/** Provider credentials and API calls belong here, never in browser configuration. */
export interface VideoProvider {
  getCapabilities(): VideoCapabilities
  submitGeneration(
    input: VideoRequest,
    localTaskId: string,
    signal: AbortSignal,
  ): Promise<string>
  getGenerationStatus(
    remoteTaskId: string,
    signal: AbortSignal,
  ): Promise<{ status: VideoGenerationStatus; error?: string }>
  getResult(remoteTaskId: string, signal: AbortSignal): Promise<VideoResult>
  cancelGeneration?(remoteTaskId: string, signal: AbortSignal): Promise<void>
}

export function validateVideoRequest(
  input: VideoRequest,
  provider: VideoProvider,
) {
  const caps = provider.getCapabilities()
  if (
    input.provider !== caps.provider ||
    !caps.models.includes(input.model) ||
    !caps.generationTypes.includes(input.generationType) ||
    !caps.durations.includes(input.durationSeconds) ||
    !caps.resolutions.includes(input.resolution) ||
    !caps.aspectRatios.includes(input.aspectRatio) ||
    input.prompt.length > caps.maxPromptLength
  )
    throw new Error('服务商或模型不支持所选视频参数')
  if (input.generationType === 'reference_to_video') {
    if (input.frames || input.frameMode)
      throw new Error('参考生成不能同时指定首尾帧')
    const limits = caps.references
    const refs = input.references || []
    const images = refs.filter((ref) => ref.type === 'image')
    if (
      !limits ||
      !refs.length ||
      refs.length > limits.maxTotalFiles ||
      images.length > limits.maxImages ||
      refs.filter((ref) => ref.type === 'video').length > limits.maxVideos ||
      refs.filter((ref) => ref.type === 'audio').length > limits.maxAudio ||
      !refs.some((ref) => ref.type !== 'audio') ||
      JSON.stringify(input.inputImages) !==
        JSON.stringify(images.map((ref) => ref.imageUrl))
    )
      throw new Error('参考素材类型、数量或顺序与模型能力不匹配')
    return
  }
  if (input.references?.length) throw new Error('此模式不接受参考素材列表')
  if (input.generationType === 'image_to_video') {
    const mode = input.frameMode || 'first_frame'
    if (!(caps.frameModes || ['first_frame']).includes(mode))
      throw new Error('模型不支持所选首尾帧模式')
    const expected = mode === 'first_last_frame' ? 2 : 1
    if (input.inputImages.length !== expected)
      throw new Error('首尾帧模式需要分别提供首帧和尾帧图片')
    if (
      input.frames &&
      JSON.stringify(input.inputImages) !==
        JSON.stringify([
          input.frames.firstImageUrl,
          ...(input.frames.lastImageUrl ? [input.frames.lastImageUrl] : []),
        ])
    )
      throw new Error('首尾帧角色与输入图片顺序不匹配')
    if (mode === 'first_last_frame' && !input.frames?.lastImageUrl)
      throw new Error('缺少尾帧图片')
  } else if (input.frames || input.frameMode)
    throw new Error('文生视频不能指定首尾帧')
  if (
    input.inputImages.length > caps.maxImages ||
    (input.generationType === 'image_to_video'
      ? !input.inputImages.length
      : input.inputImages.length > 0)
  )
    throw new Error('参考图数量与生成模式不匹配')
}

/** Opt-in simulator: no paid API and no invented production endpoints. */
export class MockVideoProvider implements VideoProvider {
  constructor(private resultUrl: string) {}
  getCapabilities(): VideoCapabilities {
    return {
      provider: 'mock',
      label: 'Mock 视频（模拟任务，不生成新视频）',
      mock: true,
      models: ['mock-video'],
      generationTypes: [
        'text_to_video',
        'image_to_video',
        'reference_to_video',
      ],
      maxImages: 2,
      maxPromptLength: 20000,
      durations: [5, 10],
      frameModes: ['first_frame', 'first_last_frame'],
      resolutions: ['720p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      references: {
        maxImages: 9,
        maxVideos: 3,
        maxAudio: 3,
        maxTotalFiles: 12,
      },
    }
  }
  async submitGeneration(
    _input: VideoRequest,
    localTaskId: string,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted()
    return `${Date.now()}:${localTaskId}`
  }
  async getGenerationStatus(remoteTaskId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const elapsed = Date.now() - Number(remoteTaskId.split(':')[0])
    return {
      status: (elapsed < 3000
        ? 'queued'
        : elapsed < 6000
          ? 'processing'
          : 'succeeded') as VideoGenerationStatus,
    }
  }
  async getResult(_id: string, signal: AbortSignal): Promise<VideoResult> {
    signal.throwIfAborted()
    return { remoteUrl: this.resultUrl }
  }
}

export const videoProviders = new Map<string, VideoProvider>()
if (process.env.VIDEO_MOCK_RESULT_URL)
  videoProviders.set(
    'mock',
    new MockVideoProvider(process.env.VIDEO_MOCK_RESULT_URL),
  )

export function getVideoProvider(id: string) {
  const provider = videoProviders.get(id)
  if (!provider)
    throw new Error('视频服务商未配置；需接入真实 provider 或显式启用 mock')
  return provider
}
