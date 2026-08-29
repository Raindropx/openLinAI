import type { LlmEndpoint } from '../../../../server/common/config'

export interface LlmEndpointPreset {
  id: string
  label: string
  name: string
  baseURL: string
  model: string
  website: string
  notes: string[]
}

export const LLM_ENDPOINT_PRESETS: LlmEndpointPreset[] = [
  {
    id: 'venice-gpt-5.6-luna',
    label: 'Venice GPT-5.6 Luna',
    name: 'Venice GPT-5.6 Luna',
    baseURL: 'https://api.venice.ai/api/v1',
    model: 'openai-gpt-56-luna',
    website: 'https://venice.ai',
    notes: [
      '使用 Venice OpenAI-compatible Chat Completions 接口',
      '输入 Key 后读取 Venice 实时文本模型目录',
    ],
  },
  {
    id: 'openlux-gpt-5.6-luna',
    label: 'OpenLux GPT-5.6 Luna',
    name: 'OpenLux GPT-5.6 Luna',
    baseURL: 'https://api.openlux.ai/v1',
    model: 'gpt-5.6-luna',
    website: 'https://openlux.ai',
    notes: [
      '使用 OpenAI-compatible Chat Completions 接口',
      '模型可用性与计费以当前 Key 所属分组为准',
    ],
  },
  {
    id: 'openrouter-gpt-5.6-luna',
    label: 'OpenRouter GPT-5.6 Luna',
    name: 'OpenRouter GPT-5.6 Luna',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.6-luna',
    website: 'https://openrouter.ai',
    notes: [
      '使用 OpenRouter OpenAI-compatible Chat Completions 接口',
      '输入 Key 后读取默认输出为文本的模型目录',
    ],
  },
  {
    id: 'dragon-gpt-5.6-luna',
    label: 'DragonAPI GPT-5.6 Luna',
    name: 'DragonAPI GPT-5.6 Luna',
    baseURL: 'https://newapi.dragon3api.com/v1',
    model: 'gpt-5.6-luna',
    website: 'https://dragon3api.com',
    notes: [
      '使用 DragonAPI 当前官方 OpenAI-compatible API Base',
      '模型按账号和分组开放，输入 Key 后以实际目录为准',
    ],
  },
]

const normalizeBaseURL = (value: string) => value.trim().replace(/\/+$/, '')

export function findLlmEndpointPreset(endpoint: LlmEndpoint | undefined) {
  if (!endpoint) return undefined

  return LLM_ENDPOINT_PRESETS.find(
    (preset) =>
      normalizeBaseURL(preset.baseURL) === normalizeBaseURL(endpoint.baseURL) &&
      preset.model === endpoint.model,
  )
}
