import type { GptImageEndpoint } from '../../../../server/common/config'

export interface GptImageEndpointPreset {
  id: string
  label: string
  name: string
  baseURL: string
  model: string
  type: GptImageEndpoint['type']
  engine: NonNullable<GptImageEndpoint['engine']>
  balanceEnabled?: boolean
  balanceApiPath?: string
  balanceResultJsonKey?: string
  website: string
  notes: string[]
}

export const GPT_IMAGE_ENDPOINT_PRESETS: GptImageEndpointPreset[] = [
  {
    id: 'openlux-gpt-image-2-c',
    label: 'OpenLux gpt-image-2-c',
    name: 'OpenLux gpt-image-2-c',
    baseURL: 'https://api.openlux.ai/v1',
    model: 'gpt-image-2-c',
    type: 'yunwu',
    engine: 'openai-images',
    website: 'https://openlux.ai',
    notes: [
      '使用 OpenAI 兼容 Images 接口',
      '支持查询 New API 令牌余额',
      '模型可用性与计费以 OpenLux 控制台为准',
    ],
  },
  {
    id: 'openlux-gpt-image-2',
    label: 'OpenLux gpt-image-2',
    name: 'OpenLux gpt-image-2',
    baseURL: 'https://api.openlux.ai/v1',
    model: 'gpt-image-2',
    type: 'yunwu',
    engine: 'openai-images',
    website: 'https://openlux.ai',
    notes: [
      '使用 OpenAI 兼容 Images 接口',
      '支持查询 New API 令牌余额',
      '模型可用性与计费以 OpenLux 控制台为准',
    ],
  },
  {
    id: 'openrouter-gemini-3.1-flash-image',
    label: 'OpenRouter Gemini 3.1 Flash Image',
    name: 'OpenRouter Gemini 3.1 Flash Image',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-3.1-flash-image',
    type: 'openrouter',
    engine: 'openrouter-images',
    website: 'https://openrouter.ai',
    notes: ['使用 OpenRouter Images 专用接口', '支持查询美元余额'],
  },
  {
    id: 'dragon-gpt-image-2',
    label: 'DragonAPI gpt-image-2',
    name: 'DragonAPI gpt-image-2',
    baseURL: 'https://dragon3api.com/v1',
    model: 'gpt-image-2',
    type: 'custom',
    engine: 'openai-images',
    website: 'https://dragon3api.com',
    notes: ['1K、2K、4K 固定计费 0.0231 元/张', '有时输出分辨率不稳定'],
  },
]

const normalizeBaseURL = (value: string) => value.trim().replace(/\/+$/, '')

export function findGptImageEndpointPreset(
  endpoint: GptImageEndpoint | undefined,
) {
  if (!endpoint) return undefined

  return GPT_IMAGE_ENDPOINT_PRESETS.find(
    (preset) =>
      normalizeBaseURL(preset.baseURL) === normalizeBaseURL(endpoint.baseURL) &&
      preset.model === endpoint.model &&
      preset.type === endpoint.type &&
      preset.engine === (endpoint.engine || 'openai-images'),
  )
}
