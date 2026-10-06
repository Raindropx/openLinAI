import type { GptImageEndpoint } from '../../../../server/common/config'
import { t } from '../../../i18n'

export interface GptImageEndpointPreset {
  id: string
  label: string
  name: string
  baseURL: string
  model: string
  editModel?: string
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
    id: 'laozhang-gpt-image-2-5-web',
    label: '老张 GPT Image 2.5 Web',
    name: '老张 GPT Image 2.5 Web',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'gpt-image-2.5-web',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t('网页版支持尺寸设置；质量由服务端决定。'),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'laozhang-grok-2',
    label: '老张 Grok Imagine Image 2.0',
    name: '老张 Grok Imagine Image 2.0',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'grok-imagine-image-2.0',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t(
          'Grok 2.0 支持 1K、2K，生成质量默认 medium；编辑最多 3 张参考图，分辨率和质量由服务端决定。',
        ),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'laozhang-gpt-image-2-vip',
    label: '老张 GPT Image 2 VIP',
    name: '老张 GPT Image 2 VIP',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'gpt-image-2-vip',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t('支持文生图、参考图编辑与 1K、2K、4K 分辨率'),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'laozhang-gpt-image-2-5-flare-vip',
    label: '老张 GPT Image 2.5 Flare VIP',
    name: '老张 GPT Image 2.5 Flare VIP',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'gpt-image-2.5-flare-vip',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t('支持生成、参考图编辑、透明背景及五档质量'),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'laozhang-gpt-image-2-5-sunburst-vip',
    label: '老张 GPT Image 2.5 Sunburst VIP',
    name: '老张 GPT Image 2.5 Sunburst VIP',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'gpt-image-2.5-sunburst-vip',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t('支持生成、参考图编辑、透明背景及五档质量'),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'laozhang-nano-banana-2',
    label: '老张 Nano Banana 2',
    name: '老张 Nano Banana 2',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'gemini-3.1-flash-image',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t('使用 Gemini 原生接口控制比例和 1K、2K、4K 分辨率'),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'laozhang-nano-banana-pro',
    label: '老张 Nano Banana Pro',
    name: '老张 Nano Banana Pro',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'gemini-3-pro-image',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t('使用 Gemini 原生接口，支持最多 14 张参考图'),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'laozhang-nano-banana-2-lite',
    label: '老张 Nano Banana 2 Lite',
    name: '老张 Nano Banana 2 Lite',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'gemini-3.1-flash-lite-image',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t('轻量生成与编辑；仅支持 1K 分辨率'),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'laozhang-seedream-5-flash',
    label: '老张 Seedream 5.0 Flash',
    name: '老张 Seedream 5.0 Flash',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'seedream-5-0-flash-260915',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t('使用 JSON 生成与编辑接口，支持最多 10 张参考图'),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'laozhang-seedream-5-pro',
    label: '老张 Seedream 5.0 Pro',
    name: '老张 Seedream 5.0 Pro',
    baseURL: 'https://api.laozhang.ai/v1',
    model: 'seedream-5-0-pro-260628',
    type: 'laozhang',
    engine: 'laozhang-images',
    balanceEnabled: false,
    website: 'https://docs.laozhang.ai',
    get notes() {
      return [
        t('使用 JSON 生成与编辑接口，支持最多 10 张参考图'),
        t('多图按单张请求生成；余额查询需要独立的系统 AccessToken'),
      ]
    },
  },
  {
    id: 'apimart-gpt-image-2',
    label: 'APImart GPT Image 2',
    name: 'APImart GPT Image 2',
    baseURL: 'https://api.apimart.ai/v1',
    model: 'gpt-image-2',
    type: 'custom',
    engine: 'apimart-images',
    balanceEnabled: true,
    balanceApiPath: '/balance',
    balanceResultJsonKey: 'remain_balance',
    website: 'https://apimart.ai',
    get notes() {
      return [
        t('支持文生图、参考图编辑与 1K、2K、4K 分辨率'),
        t('异步任务自动查询并保存图片；多图生成拆成单图请求'),
        t('余额显示当前 API Key 的剩余额度'),
      ]
    },
  },
  {
    id: 'apimart-nano-banana-2',
    label: 'APImart Nano Banana 2',
    name: 'APImart Nano Banana 2',
    baseURL: 'https://api.apimart.ai/v1',
    model: 'gemini-3.1-flash-image-preview',
    type: 'custom',
    engine: 'apimart-images',
    balanceEnabled: true,
    balanceApiPath: '/balance',
    balanceResultJsonKey: 'remain_balance',
    website: 'https://apimart.ai',
    get notes() {
      return [
        t('支持文生图、参考图编辑与 1K、2K、4K 分辨率'),
        t('异步任务自动查询并保存图片；多图生成拆成单图请求'),
        t('余额显示当前 API Key 的剩余额度'),
      ]
    },
  },
  {
    id: 'novelai-v5-full',
    label: 'NovelAI Diffusion V5 Full',
    name: 'NovelAI Diffusion V5 Full',
    baseURL: 'https://image.novelai.net',
    model: 'nai-diffusion-5-full',
    type: 'custom',
    engine: 'novelai-images',
    website: 'https://novelai.net',
    get notes() {
      return [
        t('使用 NovelAI 原生 /ai/generate-image 接口'),
        t('支持基础生成与单张参考图 img2img'),
        t('请填写 NovelAI Persistent API Token；余额查询默认关闭'),
      ]
    },
  },
  {
    id: 'pollinations-zimage',
    label: 'Pollinations Z-Image',
    name: 'Pollinations Z-Image',
    baseURL: 'https://gen.pollinations.ai/v1',
    model: 'zimage',
    editModel: 'gpt-image-2',
    type: 'custom',
    engine: 'openai-images',
    website: 'https://pollinations.ai',
    get notes() {
      return [
        t('使用 Pollinations OpenAI-compatible Images 接口'),
        t('多图生成会自动拆成多个 n=1 请求'),
        t('生成与编辑模型目录按 supported_endpoints 分开显示'),
      ]
    },
  },
  {
    id: 'venice-gpt-image-2',
    label: 'Venice GPT Image 2',
    name: 'Venice GPT Image 2',
    baseURL: 'https://api.venice.ai/api/v1',
    model: 'gpt-image-2',
    editModel: 'gpt-image-2-edit',
    type: 'venice',
    engine: 'venice-images',
    website: 'https://venice.ai',
    get notes() {
      return [
        t('使用 Venice 原生生成、单图编辑与多图编辑接口'),
        t('模型目录会实时读取，可分别选择生成模型和编辑模型'),
        t('支持同时显示 USD 与 DIEM 余额'),
      ]
    },
  },
  {
    id: 'venice-seedream-v5-pro-edit',
    label: 'Venice Seedream V5 Pro Edit',
    name: 'Venice Seedream V5 Pro Edit',
    baseURL: 'https://api.venice.ai/api/v1',
    model: 'seedream-v5-pro',
    editModel: 'seedream-v5-pro-edit',
    type: 'venice',
    engine: 'venice-images',
    website: 'https://venice.ai',
    get notes() {
      return [
        t('使用 Seedream V5 Pro 生成模型与对应 Edit 编辑模型'),
        t('支持单图和多图编辑，最多 6 张参考图'),
        t('支持 1K、2K；不支持的比例与尺寸会按实时模型能力映射'),
        t('支持同时显示 USD 与 DIEM 余额'),
      ]
    },
  },
  {
    id: 'openlux-gpt-image-2-c',
    label: 'OpenLux gpt-image-2-c',
    name: 'OpenLux gpt-image-2-c',
    baseURL: 'https://api.openlux.ai/v1',
    model: 'gpt-image-2-c',
    type: 'yunwu',
    engine: 'openai-images',
    website: 'https://openlux.ai',
    get notes() {
      return [
        t('使用 OpenAI 兼容 Images 接口'),
        t('支持查询 New API 令牌余额'),
        t('模型可用性与计费以 OpenLux 控制台为准'),
      ]
    },
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
    get notes() {
      return [
        t('使用 OpenAI 兼容 Images 接口'),
        t('支持查询 New API 令牌余额'),
        t('模型可用性与计费以 OpenLux 控制台为准'),
      ]
    },
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
    get notes() {
      return [t('使用 OpenRouter Images 专用接口'), t('支持查询美元余额')]
    },
  },
  {
    id: 'dragon-gpt-image-2',
    label: 'DragonAPI gpt-image-2',
    name: 'DragonAPI gpt-image-2',
    baseURL: 'https://newapi.dragon3api.com/v1',
    model: 'gpt-image-2',
    type: 'custom',
    engine: 'openai-images',
    website: 'https://dragon3api.com',
    get notes() {
      return [
        t('使用 DragonAPI 当前官方 OpenAI-compatible API Base'),
        t('1K、2K、4K 固定计费 0.0231 元/张'),
        t('有时输出分辨率不稳定'),
      ]
    },
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
      (!preset.editModel || preset.editModel === endpoint.editModel) &&
      preset.type === endpoint.type &&
      preset.engine === (endpoint.engine || 'openai-images'),
  )
}
