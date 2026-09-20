export const NOVELAI_IMAGE_MODELS = [
  { id: 'nai-diffusion-5-full', name: 'NovelAI Diffusion V5 Full' },
  { id: 'nai-diffusion-5-curated', name: 'NovelAI Diffusion V5 Curated' },
  { id: 'nai-diffusion-4-5-full', name: 'NovelAI Diffusion V4.5 Full' },
  {
    id: 'nai-diffusion-4-5-curated',
    name: 'NovelAI Diffusion V4.5 Curated',
  },
  { id: 'nai-diffusion-4-full', name: 'NovelAI Diffusion V4 Full' },
  {
    id: 'nai-diffusion-4-curated-preview',
    name: 'NovelAI Diffusion V4 Curated',
  },
] as const

export const NOVELAI_SAMPLERS = [
  'k_euler',
  'k_euler_ancestral',
  'k_dpmpp_2s_ancestral',
  'k_dpmpp_2m',
  'k_dpmpp_sde',
  'ddim_v3',
] as const

export const NOVELAI_NOISE_SCHEDULES = [
  'karras',
  'exponential',
  'polyexponential',
  'native',
] as const

export interface StudioProviderStatus {
  configured: boolean
  keyHint?: string
}

export interface StudioProviderSettings {
  novelai: StudioProviderStatus & { model: string }
  civitai: StudioProviderStatus
}

export interface NovelAICharacterPrompt {
  prompt: string
  negativePrompt: string
}

export interface NovelAIStudioGenerateRequest {
  title?: string
  prompt: string
  negativePrompt: string
  model: string
  width: number
  height: number
  steps: number
  scale: number
  cfgRescale: number
  sampler: (typeof NOVELAI_SAMPLERS)[number]
  noiseSchedule: (typeof NOVELAI_NOISE_SCHEDULES)[number]
  seed: number
  n: number
  qualityToggle: boolean
  characters: NovelAICharacterPrompt[]
}

export interface CivitaiModelVersionSummary {
  id: number
  name: string
  baseModel: string
  supportsGeneration: boolean
  trainedWords: string[]
}

export interface CivitaiModelSummary {
  id: number
  name: string
  type: string
  creator?: string
  imageUrl?: string
  nsfw: boolean
  supportsGeneration: boolean
  versions: CivitaiModelVersionSummary[]
}

export interface CivitaiModelSearchResult {
  items: CivitaiModelSummary[]
  nextCursor?: string
}
