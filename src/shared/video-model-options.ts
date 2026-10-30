import type { VideoRequest } from './video'
import type { VideoModelOptions, VideoProtocol } from './video-endpoints'
import { VIDEO_MODEL_CATALOG, videoOptions } from './video-endpoints'

type RecordValue = Record<string, any>
const nonempty = <T>(value: T[] | undefined, fallback: T[]) =>
  value?.length ? value : fallback

/** Generic /models directories may contain chat and image models as well. */
export function videoModelsFromCatalog(
  protocol: VideoProtocol,
  data: RecordValue,
  fallback = videoOptions(),
) {
  const models: RecordValue[] = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : []
  return [
    ...new Map(
      models.flatMap((model) => {
        const id = String(model.id || model.name || '').replace(/^models\//, '')
        if (
          !id ||
          model.model_spec?.offline === true ||
          model.available === false ||
          model.enabled === false
        )
          return []
        const output =
          model.architecture?.output_modalities || model.output_modalities
        const modality = model.modality || model.type
        const explicitVideo = Array.isArray(output)
          ? output.includes('video')
          : modality === 'video'
        const explicitOther = Array.isArray(output)
          ? !output.includes('video')
          : ['text', 'chat', 'image', 'audio', 'embedding'].includes(modality)
        const dedicatedCatalog = ['spicy', 'openrouter', 'venice'].includes(
          protocol,
        )
        const videoId =
          /(?:video|seedance|hailuo|minimax[-/]h3|fasth3|wan[\d\s./:-]|veo[-\d]|omni[-/])/i.test(
            id,
          )
        if (explicitOther || (!dedicatedCatalog && !explicitVideo && !videoId))
          return []
        if (protocol === 'gemini' && !id.includes('omni')) return []
        const known = VIDEO_MODEL_CATALOG.find(
          (item) => item.protocol === protocol && item.model === id,
        )
        return [
          [
            id,
            {
              id,
              name:
                model.model_spec?.name || model.displayName || model.name || id,
              options: videoModelOptions(
                protocol,
                model,
                known?.options || fallback,
              ),
            },
          ] as const,
        ]
      }),
    ).values(),
  ]
}
function durationsFromSchema(spec: RecordValue, fallback: number[]): number[] {
  const valid = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 600
  if (Array.isArray(spec.enum))
    return nonempty(spec.enum.filter(valid), fallback)
  const alternatives = spec.oneOf || spec.anyOf
  if (Array.isArray(alternatives))
    return nonempty(
      [
        ...new Set(
          alternatives.flatMap((item) => durationsFromSchema(item, [])),
        ),
      ].sort((a, b) => a - b),
      fallback,
    )
  if (spec.const !== undefined) return valid(spec.const) ? [spec.const] : []
  if (spec.minimum > 0 && Number.isFinite(spec.maximum))
    return Array.from(
      {
        length: Math.min(
          600,
          Math.max(0, Math.floor(spec.maximum) - Math.ceil(spec.minimum) + 1),
        ),
      },
      (_, i) => Math.ceil(spec.minimum) + i,
    ).filter(valid)
  return fallback.filter(
    (value) =>
      valid(value) &&
      value >= (spec.minimum ?? 1) &&
      value <= (spec.maximum ?? 600),
  )
}
export function videoModelOptions(
  protocol: VideoProtocol,
  record: RecordValue,
  fallback = videoOptions(),
): VideoModelOptions {
  if (protocol === 'spicy') {
    const p = record.inputSchema?.properties || {}
    const duration = p.duration_seconds || p.duration || {}
    const modes = (record.tasks || [])
      .filter((mode: string) =>
        ['text-to-video', 'image-to-video', 'reference-to-video'].includes(
          mode,
        ),
      )
      .map((mode: string) =>
        mode.split('-').join('_'),
      ) as VideoRequest['generationType'][]
    const max = (key: string, other: string) =>
      Math.min(16, p[key]?.maxItems || p[other]?.maxItems || 0)
    const imageCount = max('reference_image_urls', 'image_urls')
    const videoCount = max('reference_video_urls', 'video_urls')
    const audioCount = max('reference_audio_urls', 'audio_urls')
    return {
      ...fallback,
      generationTypes: nonempty(modes, fallback.generationTypes),
      durations: durationsFromSchema(duration, fallback.durations),
      resolutions: nonempty(p.resolution?.enum, fallback.resolutions),
      aspectRatios: nonempty(p.aspect_ratio?.enum, fallback.aspectRatios),
      maxPromptLength: p.prompt?.maxLength || fallback.maxPromptLength,
      frameModes: p.last_image_url
        ? ['first_frame', 'first_last_frame']
        : ['first_frame'],
      maxImages: imageCount || (p.image_url ? (p.last_image_url ? 2 : 1) : 0),
      references: modes.includes('reference_to_video')
        ? {
            maxImages: imageCount,
            maxVideos: videoCount,
            maxAudio: audioCount,
            maxTotalFiles: Math.max(
              1,
              Math.min(24, imageCount + videoCount + audioCount),
            ),
          }
        : undefined,
    }
  }
  if (protocol === 'openrouter')
    return {
      ...fallback,
      durations: nonempty(record.supported_durations, fallback.durations),
      resolutions: nonempty(record.supported_resolutions, fallback.resolutions),
      aspectRatios: nonempty(
        record.supported_aspect_ratios,
        fallback.aspectRatios,
      ),
      frameModes: record.supported_frame_images?.includes('last_frame')
        ? ['first_frame', 'first_last_frame']
        : ['first_frame'],
    }
  if (protocol === 'venice') {
    const c = record.model_spec?.constraints || {}
    const mode = String(record.id).includes('reference-to-video')
      ? 'reference_to_video'
      : c.model_type === 'image-to-video'
        ? 'image_to_video'
        : 'text_to_video'
    return {
      ...fallback,
      generationTypes: [mode],
      durations: nonempty(
        c.durations?.map((value: string | number) => parseInt(String(value))),
        fallback.durations,
      ),
      resolutions: nonempty(c.resolutions, fallback.resolutions),
      aspectRatios: nonempty(c.aspect_ratios, fallback.aspectRatios),
      maxPromptLength: c.prompt_character_limit || fallback.maxPromptLength,
      references:
        mode === 'reference_to_video'
          ? {
              maxImages: 9,
              maxVideos: c.video_input ? 3 : 0,
              maxAudio: c.per_reference_audio ? 3 : 0,
              maxTotalFiles: 12,
            }
          : undefined,
    }
  }
  return fallback
}
