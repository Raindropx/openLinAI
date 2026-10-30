import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  VideoCapabilities,
  VideoGenerationStatus,
  VideoRequest,
  VideoResult,
} from '../../../shared/video'
import type { VideoModelOptions } from '../../../shared/video-endpoints'
import {
  videoModelOptions,
  videoModelsFromCatalog,
} from '../../../shared/video-model-options'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { INPUT_IMAGES_API_PATH } from '../../common/static/enum'
import type { StoredVideoEndpoint } from '../../common/video-endpoint-settings'
import { getImageMimeType } from '../gpt-image/image-files'
import { uploadSpicyImage } from '../gpt-image/spicyapi-api'
import {
  readVideoJson,
  videoApiJson,
  videoApiMedia,
  videoApiResponse,
  type Json,
} from './api-transport'
import { validateVideoApiTarget } from './endpoint-network'
import { validateVideoRequest, type VideoProvider } from './providers'
import type { VideoRangeRequest } from './remote'

const modeName = (mode: VideoRequest['generationType']) =>
  mode.split('_').join('-')
export function normalizeVideoStatus(raw: unknown): VideoGenerationStatus {
  const status = String(raw).toLowerCase()
  if (['succeeded', 'completed', 'done', 'success', 'active'].includes(status))
    return 'succeeded'
  if (['failed', 'error', 'expired', 'rejected'].includes(status))
    return 'failed'
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled'
  if (
    ['queued', 'pending', 'unassigned', 'created', 'waiting'].includes(status)
  )
    return 'queued'
  if (
    [
      'running',
      'processing',
      'in_progress',
      'preparing',
      'scheduled',
      'submitted',
    ].includes(status)
  )
    return 'processing'
  throw new Error('视频服务商返回了未知任务状态')
}
export async function readVideoInputImage(raw: string) {
  const prefix = INPUT_IMAGES_API_PATH + '/'
  const name = raw.slice(prefix.length)
  if (
    !raw.startsWith(prefix) ||
    !/^[a-zA-Z0-9._-]+$/.test(name) ||
    name === '.' ||
    name === '..'
  )
    throw new Error('视频参考图必须来自已上传的本地输入图')
  const root = await fs.realpath(INPUT_IMAGES_DIR)
  const file = await fs.realpath(path.join(root, name))
  if (path.dirname(file) !== root) throw new Error('视频参考图超出输入目录')
  const stat = await fs.stat(file)
  if (!stat.isFile() || !stat.size || stat.size > 16 * 1024 * 1024)
    throw new Error('视频参考图大小无效或超过 16 MiB')
  const mime = getImageMimeType(file)
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime))
    throw new Error('视频参考图格式不受支持')
  const bytes = await fs.readFile(file)
  return {
    mime,
    bytes,
    dataURL: `data:${mime};base64,${bytes.toString('base64')}`,
  }
}

export function buildVideoBody(
  endpoint: StoredVideoEndpoint,
  input: VideoRequest,
  images: string[],
  localId: string,
): Json {
  const refs = input.references || []
  const referenceImages =
    input.generationType === 'reference_to_video' ? images : []
  const referenceVideos = refs.flatMap((ref) =>
    ref.type === 'video' ? [ref.remoteUrl] : [],
  )
  const referenceAudios = refs.flatMap((ref) =>
    ref.type === 'audio' ? [ref.remoteUrl] : [],
  )
  const frames = input.generationType === 'image_to_video' ? images : []
  let referenceImageIndex = 0
  const common = {
    model: input.model,
    prompt: input.prompt,
    duration: input.durationSeconds,
    resolution: input.resolution,
    aspect_ratio: input.aspectRatio,
  }
  switch (endpoint.protocol) {
    case 'openrouter':
      return {
        ...common,
        ...(frames.length
          ? {
              frame_images: frames.map((url, i) => ({
                type: 'image_url',
                image_url: { url },
                frame_type: i ? 'last_frame' : 'first_frame',
              })),
            }
          : {}),
        ...(refs.length
          ? {
              input_references: refs.map((ref) =>
                ref.type === 'image'
                  ? {
                      type: 'image_url',
                      image_url: {
                        url: referenceImages[referenceImageIndex++],
                      },
                    }
                  : {
                      type: `${ref.type}_url`,
                      [`${ref.type}_url`]: { url: ref.remoteUrl },
                    },
              ),
            }
          : {}),
      }
    case 'venice':
      return {
        ...common,
        duration: `${input.durationSeconds}s`,
        ...(frames.length
          ? {
              image_url: frames[0],
              ...(frames[1] ? { end_image_url: frames[1] } : {}),
            }
          : {}),
        ...(refs.length
          ? {
              reference_image_urls: images,
              reference_video_urls: referenceVideos,
              reference_audio_urls: referenceAudios,
            }
          : {}),
      }
    case 'ark':
      return {
        model: input.model,
        duration: input.durationSeconds,
        resolution: input.resolution,
        ratio:
          input.generationType === 'image_to_video'
            ? 'adaptive'
            : input.aspectRatio,
        content: [
          { type: 'text', text: input.prompt },
          ...frames.map((url, i) => ({
            type: 'image_url',
            image_url: { url },
            role: i ? 'last_frame' : 'first_frame',
          })),
          ...images
            .filter(() => refs.length)
            .map((url) => ({
              type: 'image_url',
              image_url: { url },
              role: 'reference_image',
            })),
          ...referenceVideos.map((url) => ({
            type: 'video_url',
            video_url: { url },
            role: 'reference_video',
          })),
          ...referenceAudios.map((url) => ({
            type: 'audio_url',
            audio_url: { url },
            role: 'reference_audio',
          })),
        ],
      }
    case 'openlux-wan':
    case 'laozhang-wan':
      return {
        model: input.model,
        input: {
          prompt: input.prompt,
          ...(frames.length || refs.length
            ? {
                media: [
                  ...frames.map((url, i) => ({
                    type: i ? 'last_frame' : 'first_frame',
                    url,
                  })),
                  ...referenceImages.map((url) => ({
                    type: 'reference_image',
                    url,
                  })),
                  ...referenceVideos.map((url) => ({
                    type: 'reference_video',
                    url,
                  })),
                  ...referenceAudios.map((url) => ({
                    type: 'reference_audio',
                    url,
                  })),
                ],
              }
            : {}),
        },
        parameters: {
          resolution: input.resolution.toUpperCase(),
          duration: input.durationSeconds,
          ratio: input.aspectRatio,
        },
      }
    case 'xai':
      return {
        ...common,
        ...(frames.length
          ? {
              image: { url: frames[0] },
              ...(frames[1] ? { last_frame: { url: frames[1] } } : {}),
            }
          : {}),
        ...(refs.length
          ? { reference_images: referenceImages.map((url) => ({ url })) }
          : {}),
      }
    case 'openlux-minimax':
      return {
        model: input.model,
        content: [
          { type: 'text', text: input.prompt },
          ...frames.map((url, i) => ({
            type: 'image_url',
            image_url: { url },
            role: i ? 'last_frame' : 'first_frame',
          })),
          ...referenceImages.map((url) => ({
            type: 'image_url',
            image_url: { url },
            role: 'reference_image',
          })),
          ...referenceVideos.map((url) => ({
            type: 'video_url',
            video_url: { url },
            role: 'reference_video',
          })),
          ...referenceAudios.map((url) => ({
            type: 'audio_url',
            audio_url: { url },
            role: 'reference_audio',
          })),
        ],
        duration: input.durationSeconds,
        resolution: input.resolution,
        ratio: input.aspectRatio,
      }
    case 'openlux-omni':
      return {
        model: input.model,
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        type:
          input.generationType === 'text_to_video'
            ? 1
            : input.generationType === 'image_to_video'
              ? 2
              : 3,
        ...(images.length ? { images } : {}),
      }
    case 'gemini':
      return {
        model: input.model,
        input: [
          {
            type: 'text',
            text: `${input.prompt}\nRequested duration: ${input.durationSeconds} seconds.`,
          },
          ...images.map((url) => ({
            type: 'image',
            data: url.split(',')[1],
            mime_type: url.slice(5, url.indexOf(';')),
          })),
        ],
        response_format: {
          type: 'video',
          delivery: 'uri',
          aspect_ratio: input.aspectRatio,
          resolution: input.resolution,
        },
        ...(input.generationType === 'image_to_video'
          ? { generation_config: { video_config: { task: 'image_to_video' } } }
          : {}),
      }
    case 'civitai': {
      const [engine, model] = input.model.split(':')
      const value: Json = {
        engine,
        prompt: input.prompt,
        duration: input.durationSeconds,
        resolution: input.resolution,
        aspectRatio: input.aspectRatio,
      }
      if (engine === 'minimax-h3')
        Object.assign(value, {
          model,
          firstFrameImage: frames[0],
          lastFrameImage: frames[1],
          referenceImages,
          referenceVideos,
          referenceAudios,
        })
      else if (engine === 'minimax-h3-comfy') {
        const [w, h] = input.aspectRatio.split(':').map(Number)
        const short = parseInt(input.resolution)
        const width = Math.round((w >= h ? (short * w) / h : short) / 32) * 32
        const height = Math.round((w >= h ? short : (short * h) / w) / 32) * 32
        if (width > 1344 || height > 1344)
          throw new Error('Civitai H3 Comfy 宽高不能超过 1344')
        delete value.resolution
        delete value.aspectRatio
        Object.assign(value, {
          operation: refs.length ? 'referenceToVideo' : 'imageToVideo',
          turbo: model === 'turbo',
          width,
          height,
          firstFrame: frames[0],
          lastFrame: frames[1],
          ...(refs.length ? { images: referenceImages } : {}),
        })
      } else if (engine === 'seedance') {
        if (frames.length)
          throw new Error(
            'Civitai Seedance 的 images 是参考素材，不能作为固定首尾帧提交',
          )
        Object.assign(value, {
          model,
          images: referenceImages,
          referenceVideos,
          referenceAudios,
        })
      } else if (engine === 'wan')
        Object.assign(value, {
          version: model,
          operation: modeName(input.generationType),
          cfgScale: 4,
          startImage: frames[0],
          endImage: frames[1],
        })
      else throw new Error('不支持的 Civitai 视频引擎')
      return {
        externalId: `openlinai-${localId}`,
        allowMatureContent: endpoint.allowMatureContent || false,
        steps: [{ $type: 'videoGen', name: 'video', retries: 0, input: value }],
      }
    }
    case 'fastvideo':
      return { model: input.model, prompt: input.prompt }
    case 'openai-video':
      return {
        model: input.model,
        prompt: input.prompt,
        seconds: String(input.durationSeconds),
        size: input.aspectRatio === '9:16' ? '720x1280' : '1280x720',
      }
    default:
      throw new Error('视频协议不支持直接构造请求')
  }
}

export class ConfiguredVideoProvider implements VideoProvider {
  readonly submitTimeoutMs: number
  private results = new Map<string, Json>()
  constructor(
    readonly endpoint: StoredVideoEndpoint,
    private json = videoApiJson,
    private imageReader = readVideoInputImage,
  ) {
    this.submitTimeoutMs = endpoint.protocol === 'gemini' ? 300000 : 60000
  }
  getCapabilities(): VideoCapabilities {
    return {
      ...this.endpoint.options,
      enabled: this.endpoint.enabled,
      provider: this.endpoint.id,
      label: this.endpoint.name,
      models: [this.endpoint.model],
    }
  }
  private remember(id: string, value: Json) {
    this.results.delete(id)
    this.results.set(id, value)
    while (this.results.size > 100)
      this.results.delete(this.results.keys().next().value!)
  }
  async submitGeneration(
    input: VideoRequest,
    localId: string,
    signal: AbortSignal,
  ) {
    const endpoint = this.endpoint
    const images: string[] = [...input.inputImages]
    // Validate the current Spicy schema before uploading material or creating a billable task.
    let record: Json | undefined
    if (endpoint.protocol === 'spicy')
      record = await this.json(
        endpoint,
        `/models/${input.model.split('/').map(encodeURIComponent).join('/')}`,
        signal,
      ).then((value) => value.data)
    if (
      record &&
      (!record.available ||
        !record.enabled ||
        record.modality !== 'video' ||
        !record.tasks?.includes(modeName(input.generationType)))
    )
      throw new Error('SpicyAPI 当前模型不可用或不支持所选模式')
    if (record)
      validateVideoRequest(input, {
        ...this,
        getCapabilities: () => ({
          ...this.getCapabilities(),
          ...videoModelOptions('spicy', record!, endpoint.options),
        }),
      })
    signal.throwIfAborted()
    let route = ''
    let body: Json
    if (endpoint.protocol === 'spicy') {
      const props = record!.inputSchema?.properties || {}
      const value: Json = { prompt: input.prompt }
      const fields: Json = {
        duration_seconds: input.durationSeconds,
        duration: input.durationSeconds,
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
      }
      for (const [key, item] of Object.entries(fields))
        if (props[key]) value[key] = item
      if (input.generationType === 'image_to_video') {
        value.image_url = images[0]
        if (images[1]) value.last_image_url = images[1]
      }
      if (input.generationType === 'reference_to_video') {
        if (images.length)
          value[props.image_urls ? 'image_urls' : 'reference_image_urls'] =
            images
        for (const type of ['video', 'audio']) {
          const urls = (input.references || []).flatMap((ref) =>
            ref.type === type && ref.type !== 'image' ? [ref.remoteUrl] : [],
          )
          if (urls.length)
            value[
              props[`${type}_urls`] ? `${type}_urls` : `reference_${type}_urls`
            ] = urls
        }
      }
      for (const key of record!.inputSchema?.required || [])
        if (value[key] === undefined)
          throw new Error(`视频模型需要尚未填写的参数：${key}`)
      for (const [key, item] of Object.entries(value)) {
        const spec = props[key]
        if (
          !spec ||
          (spec.enum && !spec.enum.includes(item)) ||
          (typeof item === 'number' &&
            (item < (spec.minimum ?? -Infinity) ||
              item > (spec.maximum ?? Infinity))) ||
          (typeof item === 'string' &&
            (item.length < (spec.minLength ?? 0) ||
              item.length > (spec.maxLength ?? Infinity))) ||
          (Array.isArray(item) &&
            (item.length < (spec.minItems ?? 0) ||
              item.length > (spec.maxItems ?? Infinity)))
        )
          throw new Error(`视频模型不支持当前参数：${key}`)
      }
      const uploaded = new Map<string, string>()
      for (const url of input.inputImages) {
        signal.throwIfAborted()
        const image = await this.imageReader(url)
        uploaded.set(
          url,
          await uploadSpicyImage({
            baseURL: endpoint.baseURL,
            apiKey: endpoint.apiKey,
            bytes: image.bytes,
            contentType: image.mime,
          }),
        )
      }
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' && uploaded.has(item))
          value[key] = uploaded.get(item)
        else if (Array.isArray(item))
          value[key] = item.map((url) => uploaded.get(url) || url)
      }
      route = '/jobs/createTask'
      body = { model: input.model, input: value }
    } else {
      let encodedBytes = 0
      for (let i = 0; i < images.length; i++) {
        signal.throwIfAborted()
        const image = await this.imageReader(images[i])
        encodedBytes += image.dataURL.length
        if (encodedBytes > 32 * 1024 * 1024)
          throw new Error('视频参考图编码总量超过 32 MiB，请先缩小图片')
        images[i] = image.dataURL
      }
      body = buildVideoBody(endpoint, input, images, localId)
      route = (
        {
          openrouter: '/videos',
          venice: '/video/queue',
          ark: '/contents/generations/tasks',
          'laozhang-wan':
            '/wan/api/v1/services/aigc/video-generation/video-synthesis',
          'openlux-wan':
            '/alibailian/api/v1/services/aigc/video-generation/video-synthesis',
          xai: '/videos/generations',
          civitai: '/workflows?wait=0',
          gemini: '/interactions',
          'openlux-omni': '/v1/video/create',
          'openlux-minimax': '/minimax/v2/video_generation',
          'openai-video': '/videos',
          fastvideo: '/videos',
          comfyui: '/prompt',
        } as const
      )[endpoint.protocol]
    }
    const data = await this.json(endpoint, route, signal, body, {
      ...(endpoint.protocol === 'spicy' ? { 'Idempotency-Key': localId } : {}),
      ...(['laozhang-wan', 'openlux-wan'].includes(endpoint.protocol)
        ? { 'X-DashScope-Async': 'enable' }
        : {}),
    })
    if (endpoint.protocol === 'gemini') {
      const output =
        data.output_video ||
        data.steps
          ?.filter((step: Json) => step.type === 'model_output')
          .flatMap((step: Json) => step.content || [])
          .find((item: Json) => item.type === 'video')
      const uri = String(output?.uri || '')
      const file = uri.match(/\/files\/([a-zA-Z0-9_-]+)(?::download)?/)
      if (!file || new URL(uri).origin !== new URL(endpoint.baseURL).origin)
        throw new Error('Gemini 未返回可恢复的 URI 视频结果')
      return `file:${file[1]}`
    }
    const id =
      data.data?.taskId ||
      data.output?.task_id ||
      data.queue_id ||
      data.request_id ||
      data.task?.id ||
      data.task_id ||
      data.id
    if (typeof id !== 'string' || !id || id.length > 500)
      throw new Error('视频 API 未返回有效任务 ID')
    this.remember(id, data)
    return id
  }
  private async poll(id: string, signal: AbortSignal): Promise<Json> {
    const key = encodeURIComponent(id)
    if (this.endpoint.protocol === 'venice') {
      const response = await videoApiResponse(
        this.endpoint,
        '/video/retrieve',
        signal,
        {
          model: this.endpoint.model,
          queue_id: id,
          delete_media_on_completion: false,
        },
      )
      if (
        response.statusCode === 200 &&
        response.headers['content-type']?.startsWith('video/')
      ) {
        response.destroy()
        return { status: 'completed' }
      }
      return readVideoJson(response, this.endpoint)
    }
    const route = {
      spicy: `/jobs/recordInfo?taskId=${key}`,
      openrouter: `/videos/${key}`,
      ark: `/contents/generations/tasks/${key}`,
      'laozhang-wan': `/v1/tasks/${key}`,
      'openlux-wan': `/alibailian/api/v1/tasks/${key}`,
      xai: `/videos/${key}`,
      civitai: `/workflows/${key}?wait=0&hideMatureContent=false`,
      gemini: `/files/${encodeURIComponent(id.replace(/^file:/, ''))}`,
      'openlux-minimax': `/minimax/v2/query/video_generation/${key}`,
      'openlux-omni': `/v1/video/query?id=${key}`,
      'openai-video': `/videos/${key}`,
      fastvideo: `/videos/${key}`,
      comfyui: undefined,
    }[this.endpoint.protocol]
    return this.json(this.endpoint, route!, signal)
  }
  async getGenerationStatus(id: string, signal: AbortSignal) {
    const result = await this.poll(id, signal)
    this.remember(id, result)
    const data =
      result.task || (this.endpoint.protocol === 'spicy' ? result.data : result)
    const raw =
      data.status || data.state || data.task_status || data.output?.task_status
    return { status: normalizeVideoStatus(raw) }
  }
  async getResult(id: string, signal: AbortSignal): Promise<VideoResult> {
    const cached = this.results.get(id)
    this.results.delete(id)
    const data = cached || (await this.poll(id, signal))
    const value =
      data.task || (this.endpoint.protocol === 'spicy' ? data.data : data)
    const blob = data.steps?.find((step: Json) => step.output?.video)?.output
      ?.video
    const url =
      value.urls?.[0] ||
      value.video?.url ||
      value.content?.video_url ||
      value.data?.content?.video_url ||
      value.result_url ||
      value.video_url ||
      value.output?.video_url ||
      value.detail?.video_url ||
      value.output?.assets?.find((asset: Json) =>
        String(asset.mime).startsWith('video/'),
      )?.url ||
      blob?.url
    const expires = value.expires_at
    const expiresAt =
      typeof expires === 'number'
        ? expires > 1e12
          ? expires
          : expires * 1000
        : typeof expires === 'string'
          ? Date.parse(expires)
          : undefined
    if (typeof url === 'string' && this.endpoint.network === 'local') {
      const route = url.startsWith('/')
        ? url
        : url.slice(this.endpoint.baseURL.length)
      const target = await validateVideoApiTarget(this.endpoint, route)
      if (!url.startsWith('/') && target.url.href !== new URL(url).href)
        throw new Error('内网结果地址超出配置的视频端点')
      return { remoteUrl: target.url.href, providerMedia: true }
    }
    if (typeof url === 'string' && url.startsWith('https://'))
      return {
        remoteUrl: url,
        ...(blob?.urlExpiresAt
          ? { remoteUrlExpiresAt: Date.parse(blob.urlExpiresAt) }
          : {}),
        ...(expiresAt ? { remoteUrlExpiresAt: expiresAt } : {}),
      }
    const protectedRoute = this.mediaRoute(id)
    if (protectedRoute)
      return {
        remoteUrl: this.endpoint.baseURL + protectedRoute,
        providerMedia: true,
      }
    throw new Error('视频任务已结束但未返回可下载结果，请检查服务商任务记录')
  }
  private mediaRoute(id: string) {
    const key = encodeURIComponent(id)
    if (
      this.endpoint.protocol === 'openrouter' ||
      this.endpoint.protocol === 'openai-video' ||
      this.endpoint.protocol === 'fastvideo'
    )
      return `/videos/${key}/content`
    if (this.endpoint.protocol === 'venice')
      return `/video/retrieve?queue_id=${key}`
    if (this.endpoint.protocol === 'gemini')
      return `/files/${encodeURIComponent(id.replace(/^file:/, ''))}:download?alt=media`
    return undefined
  }
  async openResult(id: string, signal: AbortSignal, range?: VideoRangeRequest) {
    const route =
      this.endpoint.network === 'local'
        ? (await this.getResult(id, signal)).remoteUrl!.slice(
            this.endpoint.baseURL.length,
          )
        : this.mediaRoute(id)
    if (!route) throw new Error('该视频端点未声明受控视频下载接口')
    return videoApiMedia(
      this.endpoint,
      this.endpoint.protocol === 'venice' ? '/video/retrieve' : route,
      signal,
      range,
      this.endpoint.protocol === 'venice'
        ? {
            model: this.endpoint.model,
            queue_id: id,
            delete_media_on_completion: false,
          }
        : undefined,
    )
  }
}

export async function discoverVideoModels(
  endpoint: StoredVideoEndpoint,
  transport: typeof videoApiJson = videoApiJson,
): Promise<Array<{ id: string; name: string; options?: VideoModelOptions }>> {
  if (endpoint.protocol === 'comfyui')
    throw new Error('ComfyUI 使用导入的 API 工作流，不读取云端模型目录')
  if (endpoint.protocol === 'civitai')
    throw new Error(
      'Civitai 未提供视频模型目录接口，请选择内置候选或手动填写模型 ID',
    )
  const signal = AbortSignal.timeout(30000)
  const route =
    endpoint.protocol === 'spicy'
      ? '/models?modality=video'
      : endpoint.protocol === 'openrouter'
        ? '/videos/models'
        : endpoint.protocol === 'venice'
          ? '/models?type=video'
          : endpoint.protocol === 'gemini'
            ? '/models'
            : '/models'
  const data = await transport(endpoint, route, signal)
  return videoModelsFromCatalog(endpoint.protocol, data, endpoint.options)
}

export async function inspectVideoModel(
  endpoint: StoredVideoEndpoint,
): Promise<VideoModelOptions> {
  if (endpoint.protocol === 'spicy') {
    const data = await videoApiJson(
      endpoint,
      `/models/${endpoint.model.split('/').map(encodeURIComponent).join('/')}`,
      AbortSignal.timeout(30000),
    )
    if (
      data.data?.modality !== 'video' ||
      !data.data.available ||
      !data.data.enabled
    )
      throw new Error('所选 SpicyAPI 视频模型当前不可用')
    return videoModelOptions('spicy', data.data, endpoint.options)
  }
  const models = await discoverVideoModels(endpoint)
  const model = models.find((model) => model.id === endpoint.model)
  if (!model?.options)
    throw new Error('所选视频模型不在服务商当前目录中，请重新读取并选择模型')
  return model.options
}
