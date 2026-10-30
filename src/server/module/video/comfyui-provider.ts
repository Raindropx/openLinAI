import { randomInt } from 'node:crypto'
import { comfyVideoSchema } from '../../../shared/comfyui-video'
import type { VideoRequest, VideoResult } from '../../../shared/video'
import type { StoredVideoEndpoint } from '../../common/video-endpoint-settings'
import { videoApiJson, videoApiMedia, type Json } from './api-transport'
import { readVideoInputImage } from './configured-provider'
import type { VideoProvider } from './providers'
import type { VideoRangeRequest } from './remote'

export class ComfyVideoProvider implements VideoProvider {
  readonly submitTimeoutMs = 120000
  constructor(
    readonly endpoint: StoredVideoEndpoint,
    private json = videoApiJson,
    private imageReader = readVideoInputImage,
  ) {}
  getCapabilities() {
    return {
      ...this.endpoint.options,
      enabled: this.endpoint.enabled && Boolean(this.endpoint.comfyUI),
      provider: this.endpoint.id,
      label: this.endpoint.name,
      models: [this.endpoint.model],
    }
  }
  async submitGeneration(
    input: VideoRequest,
    localId: string,
    signal: AbortSignal,
  ) {
    const config = comfyVideoSchema.parse(this.endpoint.comfyUI)
    const workflow = structuredClone(config.workflow)
    if ((input.references || []).some((ref) => ref.type !== 'image'))
      throw new Error('ComfyUI 当前仅支持上传参考图片')
    const imageBindings = config.bindings.filter(
      (binding) => binding.source === 'image',
    )
    for (const binding of imageBindings)
      if (!input.inputImages[binding.imageIndex ?? 0])
        throw new Error(
          '工作流映射需要的输入图片尚未提供；请为不同模式分别配置端点',
        )
    for (let index = 0; index < input.inputImages.length; index++)
      if (!imageBindings.some((binding) => (binding.imageIndex ?? 0) === index))
        throw new Error(`第 ${index + 1} 张输入图片没有工作流映射`)

    const values: Json = {
      prompt: input.prompt,
      durationSeconds: input.durationSeconds,
      fps: config.fps,
      frameCount: Math.max(
        1,
        Math.round(input.durationSeconds * config.fps) +
          config.frameCountOffset,
      ),
      seed: randomInt(0, 2 ** 48 - 1),
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
    }
    if (
      config.bindings.some((binding) =>
        ['width', 'height'].includes(binding.source),
      )
    ) {
      const match = /^(\d+)p$/i.exec(input.resolution)
      const ratio = /^(\d+):(\d+)$/.exec(input.aspectRatio)
      if (!match || !ratio || !Number(ratio[1]) || !Number(ratio[2]))
        throw new Error('宽高映射需要如 720p 的分辨率和 16:9 的比例')
      const short = Number(match[1]),
        w = Number(ratio[1]),
        h = Number(ratio[2])
      values.width = Math.max(
        32,
        Math.round((w >= h ? (short * w) / h : short) / 32) * 32,
      )
      values.height = Math.max(
        32,
        Math.round((w >= h ? short : (short * h) / w) / 32) * 32,
      )
      if (Math.max(values.width, values.height) > 16384)
        throw new Error('视频宽高映射超出范围')
    }
    // Check all mappings before uploading; each input image is uploaded only once.
    const images: string[] = []
    for (const [index, source] of input.inputImages.entries()) {
      signal.throwIfAborted()
      const image = await this.imageReader(source)
      const form = new FormData()
      const ext = image.mime === 'image/jpeg' ? 'jpg' : image.mime.split('/')[1]
      form.set(
        'image',
        new Blob([new Uint8Array(image.bytes)], { type: image.mime }),
        `openlinai-${localId}-${index}.${ext}`,
      )
      form.set('type', 'input')
      form.set('overwrite', 'false')
      const uploaded = await this.json(
        this.endpoint,
        '/upload/image',
        signal,
        form,
      )
      if (
        typeof uploaded.name !== 'string' ||
        !uploaded.name ||
        (uploaded.subfolder !== undefined &&
          typeof uploaded.subfolder !== 'string')
      )
        throw new Error('ComfyUI 未返回有效的上传图片名称')
      images.push([uploaded.subfolder, uploaded.name].filter(Boolean).join('/'))
    }
    for (const binding of config.bindings)
      workflow[binding.nodeId].inputs[binding.input] =
        binding.source === 'image'
          ? images[binding.imageIndex ?? 0]
          : values[binding.source]
    const result = await this.json(this.endpoint, '/prompt', signal, {
      prompt: workflow,
      client_id: `openlinai-${localId}`,
    })
    if (
      typeof result.prompt_id !== 'string' ||
      !result.prompt_id ||
      result.error ||
      (result.node_errors && Object.keys(result.node_errors).length)
    )
      throw new Error('ComfyUI 未接受工作流，请检查模型、节点及输入映射')
    return result.prompt_id
  }
  private async history(
    id: string,
    signal: AbortSignal,
  ): Promise<Json | undefined> {
    return (
      await this.json(
        this.endpoint,
        `/history/${encodeURIComponent(id)}`,
        signal,
      )
    )[id]
  }
  private historyStatus(history: Json) {
    if (
      history.status?.status_str === 'error' ||
      history.status?.messages?.some((message: unknown[]) =>
        ['execution_error', 'execution_interrupted'].includes(
          String(message[0]),
        ),
      )
    )
      return {
        status: 'failed' as const,
        error: 'ComfyUI 工作流执行失败或被中断，请查看 ComfyUI 日志',
      }
    return {
      status: history.status?.completed
        ? ('succeeded' as const)
        : ('processing' as const),
    }
  }
  async getGenerationStatus(id: string, signal: AbortSignal) {
    const history = await this.history(id, signal)
    if (history) return this.historyStatus(history)
    const queue = await this.json(this.endpoint, '/queue', signal)
    if (queue.queue_running?.some((entry: unknown[]) => entry[1] === id))
      return { status: 'processing' as const }
    if (queue.queue_pending?.some((entry: unknown[]) => entry[1] === id))
      return { status: 'queued' as const }
    // Recheck after queue: a task may have completed between the two requests.
    const finished = await this.history(id, signal)
    if (finished) return this.historyStatus(finished)
    throw new Error('ComfyUI 任务不在队列或历史中，可能已被清理或服务已重启')
  }
  private async mediaRoute(id: string, signal: AbortSignal) {
    const history = await this.history(id, signal)
    if (!history?.status?.completed || history.status.status_str === 'error')
      throw new Error('ComfyUI 任务尚未成功完成')
    const outputId = this.endpoint.comfyUI?.outputNodeId
    const outputs: Json[] = outputId
      ? [history.outputs?.[outputId]]
      : Object.values(history.outputs || {})
    // Native SaveVideo/SaveWEBM and VideoHelperSuite use these UI output lists.
    for (const output of outputs) {
      for (const key of ['videos', 'gifs', 'images']) {
        for (const item of Array.isArray(output?.[key]) ? output[key] : []) {
          if (
            typeof item.filename !== 'string' ||
            !/\.(mp4|webm)$/i.test(item.filename) ||
            !['output', 'temp'].includes(item.type || 'output') ||
            (item.subfolder !== undefined && typeof item.subfolder !== 'string')
          )
            continue
          const query = new URLSearchParams({
            filename: item.filename,
            subfolder: item.subfolder || '',
            type: item.type || 'output',
          })
          return `/view?${query}`
        }
      }
    }
    throw new Error('ComfyUI 未返回 MP4/WebM，请配置保存视频节点或指定输出节点')
  }
  async getResult(id: string, signal: AbortSignal): Promise<VideoResult> {
    return {
      remoteUrl: this.endpoint.baseURL + (await this.mediaRoute(id, signal)),
      providerMedia: true,
    }
  }
  async openResult(id: string, signal: AbortSignal, range?: VideoRangeRequest) {
    return videoApiMedia(
      this.endpoint,
      await this.mediaRoute(id, signal),
      signal,
      range,
    )
  }
  // Deliberately do not call /interrupt: it can stop unrelated users' running work.
}
