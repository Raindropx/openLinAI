import type { StudioItem } from '../../../../shared/studio'
import type { CivitaiGenerateRequest } from '../../../../shared/civitai-generation'

export interface StudioGenerationParameters {
  civitai?: CivitaiGenerateRequest
  prompt?: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  sampler?: string
  scale?: number
  seed?: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Read the fields shared by image providers, including common PNG parameter text. */
export function studioGenerationParameters(item: StudioItem): StudioGenerationParameters | undefined {
  const source = item.provenance
  if (!source.sourceTaskId && !source.novelai && !source.civitai && !source.generation) return undefined

  if (source.civitai) {
    const request = source.civitai.request
    return { prompt: request.prompt, negativePrompt: request.negativePrompt, width: request.width, height: request.height, steps: request.steps, sampler: request.sampler, scale: request.scale, seed: source.civitai.seed, civitai: request }
  }

  const snapshot = source.novelai
  const metadata = source.sourceMetadata || {}
  let comment: Record<string, unknown> | undefined
  try { comment = record(JSON.parse(metadata.Comment || '{}')) } catch { /* Metadata is optional. */ }
  const embedded = record(comment?.novelai)
  const request = snapshot?.request || record(embedded?.request)
  // openLinAI's generic export uses placeholder Steps/CFG/Seed values; those
  // are not the provider's actual settings.
  const parameters = comment?.schema === 'openlinai.image-generation.v1' ? '' : metadata.parameters || ''
  const field = (name: string) => parameters.match(new RegExp(`(?:^|[,\\r\\n]\\s*)${name}:\\s*([^,\\r\\n]+)`, 'i'))?.[1]?.trim()
  const size = parameters.match(/(?:^|[,\r\n]\s*)Size:\s*(\d+)\s*[x×]\s*(\d+)/i)
  const requestedSize = string(comment?.requestedSize)?.match(/^(\d+)\s*[x×]\s*(\d+)$/i)
  const output = record(comment?.output)
  const negative = parameters.match(/(?:^|\n)Negative prompt:\s*([^\n]*)/i)?.[1]?.trim()
  const prompt = string(request?.prompt) || string(comment?.prompt) || string(source.generation?.prompt) || string(source.template?.prompt)
    || (parameters ? parameters.split(/\n(?:Negative prompt:|Steps:)/i)[0].trim() : undefined)
  const values: StudioGenerationParameters = {
    prompt,
    negativePrompt: typeof request?.negativePrompt === 'string' ? request.negativePrompt : string(comment?.negativePrompt) || string(comment?.uc) || negative,
    width: number(request?.width) ?? number(comment?.width) ?? number(output?.width) ?? number(size?.[1]) ?? number(requestedSize?.[1]),
    height: number(request?.height) ?? number(comment?.height) ?? number(output?.height) ?? number(size?.[2]) ?? number(requestedSize?.[2]),
    steps: number(request?.steps) ?? number(comment?.steps) ?? number(field('Steps')),
    sampler: string(request?.sampler) || string(comment?.sampler) || field('Sampler'),
    scale: number(request?.scale) ?? number(comment?.scale) ?? number(comment?.cfg_scale) ?? number(field('CFG scale')),
    seed: snapshot?.seed ?? number(embedded?.seed) ?? number(request?.seed) ?? number(comment?.seed) ?? number(field('Seed')),
  }
  return Object.values(values).some((value) => value !== undefined) ? values : undefined
}
