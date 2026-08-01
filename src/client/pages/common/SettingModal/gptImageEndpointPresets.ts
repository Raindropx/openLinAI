import type { GptImageEndpoint } from '../../../../server/common/config'

export interface GptImageEndpointPreset {
  id: string
  label: string
  name: string
  baseURL: string
  model: string
  type: GptImageEndpoint['type']
  engine: NonNullable<GptImageEndpoint['engine']>
  website: string
  notes: string[]
}

export const GPT_IMAGE_ENDPOINT_PRESETS: GptImageEndpointPreset[] = [
  {
    id: 'yunwu-gpt-image-2-c',
    label: '云雾 gpt-image-2-c',
    name: '云雾 gpt-image-2-c',
    baseURL: 'https://api.oljjio.xyz/v1',
    model: 'gpt-image-2-c',
    type: 'yunwu',
    engine: 'openai-images',
    website: 'https://api.oljjio.xyz',
    notes: ['1K、2K、4K 固定计费 0.075 元/张', '需要 GPT绘图 分组'],
  },
  {
    id: 'yunwu-gpt-image-2',
    label: '云雾 gpt-image-2',
    name: '云雾 gpt-image-2',
    baseURL: 'https://api.oljjio.xyz/v1',
    model: 'gpt-image-2',
    type: 'yunwu',
    engine: 'openai-images',
    website: 'https://api.oljjio.xyz',
    notes: ['截至 2026-08-01，除 8 倍优质官转分组外其他分组可能不可用'],
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
