import type { StudioItem } from './studio'

// Civitai v2 imageGen / sdcpp enums, not the legacy v1 Scheduler values.
export const CIVITAI_SAMPLERS = [
  'euler',
  'euler_a',
  'heun',
  'dpm2',
  'dpm++2s_a',
  'dpm++2m',
  'dpm++2mv2',
  'ipndm',
  'ipndm_v',
  'ddim_trailing',
  'lcm',
  'res_multistep',
  'res_2s',
  'tcd',
  'er_sde',
] as const
export const CIVITAI_SCHEDULES = [
  'discrete',
  'karras',
  'exponential',
  'simple',
  'ays',
  'bong_tangent',
  'gits',
  'sgm_uniform',
  'smoothstep',
  'kl_optimal',
  'lcm',
] as const

export function civitaiEcosystem(
  baseModel: string,
): 'sd1' | 'sdxl' | undefined {
  if (['SD 1.4', 'SD 1.5', 'SD 1.5 LCM', 'SD 1.5 Hyper'].includes(baseModel))
    return 'sd1'
  if (
    [
      'SDXL 1.0',
      'SDXL 1.0 LCM',
      'SDXL Turbo',
      'SDXL Lightning',
      'SDXL Hyper',
      'Pony',
      'Illustrious',
      'NoobAI',
    ].includes(baseModel)
  )
    return 'sdxl'
}

export interface CivitaiResource {
  modelId: number
  versionId: number
  name: string
  baseModel: string
  type: 'Checkpoint' | 'LORA' | 'LoCon'
}

export interface CivitaiGenerateRequest {
  model: CivitaiResource
  loras: Array<CivitaiResource & { strength: number }>
  prompt: string
  negativePrompt: string
  width: number
  height: number
  steps: number
  scale: number
  sampler: (typeof CIVITAI_SAMPLERS)[number]
  schedule: (typeof CIVITAI_SCHEDULES)[number]
  seed: number
  n: number
  clipSkip: number
  referenceItemId?: string
  strength: number
  allowMatureContent: boolean
  saveToTaskList: boolean
}

export interface CivitaiGenerationSnapshot {
  version: 1
  request: CivitaiGenerateRequest
  workflowId: string
  imageIndex: number
  /** Each image is submitted as its own seeded step. */
  seed: number
}

export type CivitaiJobStatus =
  | 'submitting'
  | 'unknown'
  | 'unassigned'
  | 'preparing'
  | 'scheduled'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'canceled'
export const civitaiJobFinished = (status: CivitaiJobStatus) =>
  ['succeeded', 'failed', 'expired', 'canceled'].includes(status)
export const CIVITAI_STATUS_LABELS: Record<CivitaiJobStatus, string> = {
  submitting: '正在提交',
  unknown: '提交结果待确认',
  unassigned: '等待分配',
  preparing: '准备模型',
  scheduled: '排队中',
  processing: '生成中',
  succeeded: '已完成',
  failed: '失败',
  expired: '已超时',
  canceled: '已取消',
}

export interface CivitaiStudioJob {
  id: string
  workflowId?: string
  createdAt: number
  status: CivitaiJobStatus
  progress?: number
  cost?: number
  error?: string
  warning?: string
  items: StudioItem[]
  /** Upstream is terminal and all available images have been saved locally. */
  settled: boolean
}
