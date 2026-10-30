import { z } from 'zod'
import type { VideoCapabilities, VideoRequest } from './video'

export const VIDEO_PROTOCOLS = {
  spicy: 'SpicyAPI Jobs',
  openrouter: 'OpenRouter Videos',
  venice: 'Venice Video',
  ark: 'Seedance / Ark',
  'laozhang-wan': 'LaoZhang Wan',
  'openlux-minimax': 'OpenLux MiniMax V2',
  'openlux-wan': 'OpenLux Wan / DashScope',
  'openlux-omni': 'OpenLux Omni',
  gemini: 'Gemini Interactions',
  xai: 'Grok / xAI',
  civitai: 'Civitai Orchestration v2',
  'openai-video': 'OpenAI-compatible Video Jobs',
  fastvideo: 'FastVideo / FastH3',
} as const
export type VideoProtocol = keyof typeof VIDEO_PROTOCOLS
export type VideoModelOptions = Pick<
  VideoCapabilities,
  | 'generationTypes'
  | 'durations'
  | 'resolutions'
  | 'aspectRatios'
  | 'maxImages'
  | 'maxPromptLength'
  | 'frameModes'
  | 'references'
>
export interface VideoEndpoint {
  id: string
  name: string
  enabled: boolean
  baseURL: string
  protocol: VideoProtocol
  model: string
  options: VideoModelOptions
  mediaHosts: string[]
  apiKeyConfigured?: boolean
  keyHint?: string
  /** Omitted on read; an empty value preserves the saved credential. */
  apiKey?: string
  allowMatureContent?: boolean
  notes?: string
}
export interface VideoEndpointPreset extends Omit<
  VideoEndpoint,
  'id' | 'apiKeyConfigured' | 'keyHint'
> {
  id: string
  website: string
  needsReview?: boolean
}
const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
  )
const list = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(600)
export const videoEndpointSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  baseURL: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((raw) => {
      const url = new URL(raw)
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (!url.port || url.port === '443')
      )
    }, '视频 API 地址必须是无凭据和查询参数的 HTTPS 地址'),
  protocol: z.enum(
    Object.keys(VIDEO_PROTOCOLS) as [VideoProtocol, ...VideoProtocol[]],
  ),
  model: z.string().trim().min(1).max(200),
  options: z.object({
    generationTypes: list(
      z.enum(['text_to_video', 'image_to_video', 'reference_to_video']),
    ),
    durations: list(z.number().int().min(1).max(600)),
    resolutions: list(z.string().min(1).max(40)),
    aspectRatios: list(z.string().min(1).max(40)),
    maxImages: z.number().int().min(0).max(16),
    maxPromptLength: z.number().int().min(1).max(20000),
    frameModes: list(z.enum(['first_frame', 'first_last_frame'])).optional(),
    references: z
      .object({
        maxImages: z.number().int().min(0).max(16),
        maxVideos: z.number().int().min(0).max(16),
        maxAudio: z.number().int().min(0).max(16),
        maxTotalFiles: z.number().int().min(1).max(24),
      })
      .optional(),
  }),
  mediaHosts: z.array(hostname).max(50),
  apiKey: z.string().trim().max(4096).optional(),
  allowMatureContent: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
})

const range = (min: number, max: number) =>
  Array.from({ length: max - min + 1 }, (_, i) => min + i)
export function videoOptions(
  overrides: Partial<VideoModelOptions> = {},
): VideoModelOptions {
  return {
    generationTypes: ['text_to_video', 'image_to_video'],
    durations: [5, 10],
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
    maxImages: 2,
    maxPromptLength: 7000,
    frameModes: ['first_frame', 'first_last_frame'],
    ...overrides,
  }
}
const refs = (images = 9, videos = 3, audio = 3) => ({
  maxImages: images,
  maxVideos: videos,
  maxAudio: audio,
  maxTotalFiles: Math.min(24, images + videos + audio),
})
const allModes: VideoRequest['generationType'][] = [
  'text_to_video',
  'image_to_video',
  'reference_to_video',
]
const ratios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const preset = (
  id: string,
  name: string,
  protocol: VideoProtocol,
  baseURL: string,
  model: string,
  options: VideoModelOptions,
  website: string,
  mediaHosts: string[] = [],
  notes = '',
): VideoEndpointPreset => ({
  id,
  name,
  protocol,
  baseURL,
  model,
  options,
  website,
  mediaHosts,
  notes,
  enabled: true,
})

/** Model defaults are separate from connection presets; IDs remain editable. */
export const VIDEO_MODEL_CATALOG: VideoEndpointPreset[] = [
  ...[
    ['minimax/h3', 'MiniMax H3', ['480p', '768p', '2k'], 5, 15],
    ['minimax/h3-highspeed', 'MiniMax H3 HighSpeed', ['768p'], 4, 15],
    [
      'bytedance/seedance-2.0',
      'Seedance 2.0',
      ['480p', '720p', '1080p'],
      4,
      15,
    ],
    [
      'bytedance/seedance-2.0-fast',
      'Seedance 2.0 Fast',
      ['480p', '720p', '1080p'],
      4,
      15,
    ],
    [
      'bytedance/seedance-2.5',
      'Seedance 2.5',
      ['480p', '720p', '1080p'],
      4,
      30,
    ],
    ['alibaba/wan-3.0', 'Wan 3.0', ['480p', '720p', '1080p'], 2, 30],
  ].flatMap(([slug, label, resolutions, min, max]) =>
    ['text-to-video', 'image-to-video', 'reference-to-video'].map((mode) =>
      preset(
        `spicy-${String(slug).split('/').join('-')}-${mode}`,
        `SpicyAPI · ${label} · ${mode}`,
        'spicy',
        'https://api.spicyapi.ai/api/v1',
        `${slug}/${mode}`,
        videoOptions({
          generationTypes: [
            mode.split('-').join('_') as VideoRequest['generationType'],
          ],
          durations: range(Number(min), Number(max)),
          resolutions: resolutions as string[],
          aspectRatios: ratios,
          references: mode === 'reference-to-video' ? refs() : undefined,
        }),
        `https://spicyapi.ai/models/${String(slug).replace('minimax/', 'minimax-').split('/').pop()!.split('.').join('-')}`,
        ['cdn.spicyapi.ai'],
        '填写 Key 后自动读取模型目录与参数，生成前再次校验。',
      ),
    ),
  ),
  ...[
    'minimax/hailuo-3',
    'minimax/hailuo-3-max',
    'bytedance/seedance-2.0',
    'bytedance/seedance-2.0-fast',
    'bytedance/seedance-2.5',
    'alibaba/wan-3.0',
  ].map((model) =>
    preset(
      `openrouter-${model.split('/').join('-')}`,
      `OpenRouter · ${model}`,
      'openrouter',
      'https://openrouter.ai/api/v1',
      model,
      videoOptions({
        generationTypes: allModes,
        durations: range(5, 15),
        resolutions: ['720p'],
        references: refs(),
      }),
      'https://openrouter.ai/docs/guides/overview/multimodal/video-generation',
      ['openrouter.ai'],
      '读取视频模型目录确认当前账号与模型支持的参数。',
    ),
  ),
  ...[
    'seedance-2-0',
    'seedance-2-0-fast',
    'seedance-2-5',
    'minimax-h3',
    'wan-3-0',
  ].flatMap((family) =>
    ['text-to-video', 'image-to-video', 'reference-to-video'].map((mode) => {
      const model = `${family}-${mode}${family.startsWith('seedance') ? '-basic' : ''}`
      return preset(
        `venice-${model}`,
        `Venice · ${model}`,
        'venice',
        'https://api.venice.ai/api/v1',
        model,
        videoOptions({
          generationTypes: [
            mode.split('-').join('_') as VideoRequest['generationType'],
          ],
          maxImages: 9,
          durations: [5, 10],
          resolutions:
            family === 'minimax-h3' ? ['768P', '2K'] : ['720p', '1080p'],
          references: mode === 'reference-to-video' ? refs(9, 0, 0) : undefined,
        }),
        'https://docs.venice.ai/api-reference/endpoint/video/queue',
        ['api.venice.ai'],
        '可读取 Venice 视频模型目录；不同生成模式使用不同模型 ID。',
      )
    }),
  ),
  ...[
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-2-5-260628',
  ].map((model) =>
    preset(
      `laozhang-${model}`,
      `老张 · ${model}`,
      'ark',
      'https://api.laozhang.ai/seedance/api/v3',
      model,
      videoOptions({
        generationTypes: allModes,
        durations: range(4, model.includes('2-5') ? 30 : 15),
        resolutions: ['480p', '720p', '1080p'],
        aspectRatios: ratios,
        references: refs(),
      }),
      'https://docs.laozhang.ai/api-capabilities/seedance2-video-generation',
      [],
      '需要 SeeDance2 令牌分组；结果 CDN 域名以实际响应为准。',
    ),
  ),
  ...['wan2.7-t2v', 'wan2.7-i2v', 'wan2.7-r2v', 'wan3.0-video'].map((model) =>
    preset(
      `laozhang-${model}`,
      `老张 · ${model}`,
      'laozhang-wan',
      'https://api.laozhang.ai',
      model,
      videoOptions({
        generationTypes: model.endsWith('t2v')
          ? ['text_to_video']
          : model.endsWith('i2v')
            ? ['image_to_video']
            : model.endsWith('r2v')
              ? ['reference_to_video']
              : allModes,
        durations: range(5, 15),
        resolutions: ['720p', '1080p'],
        aspectRatios: ['16:9', '9:16', '1:1'],
        frameModes: ['first_frame'],
        references: refs(9, 0, 0),
      }),
      'https://docs.laozhang.ai/api-capabilities/wan-video-generation',
      [],
      '结果 CDN 域名以实际响应为准。',
    ),
  ),
  ...['MiniMax-H3', 'MiniMax-H3-Max'].map((model) =>
    preset(
      `openlux-${model}`,
      `OpenLux · ${model}`,
      'openlux-minimax',
      'https://api.openlux.ai',
      model,
      videoOptions({
        durations: range(model.endsWith('Max') ? 5 : 4, 15),
        resolutions: model.endsWith('Max') ? ['480P', '768P'] : ['768P', '2K'],
        generationTypes: allModes,
        references: refs(),
        aspectRatios: ratios,
      }),
      'https://doc.openlux.ai/en/reference/v1/minimax/v2/video_generation',
      [],
      '使用 MiniMax V2 content 多模态协议。',
    ),
  ),
  ...[
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-2-5-260628',
  ].map((model) =>
    preset(
      `openlux-${model}`,
      `OpenLux · ${model}`,
      'ark',
      'https://api.openlux.ai/api/v3',
      model,
      videoOptions({
        generationTypes: allModes,
        references: refs(),
        durations: range(4, model.includes('2-5') ? 30 : 15),
        resolutions: ['480p', '720p', '1080p'],
        aspectRatios: ratios,
      }),
      'https://doc.openlux.ai/en/reference',
      [],
      '使用文档中的 Ark 原生任务路径；模型可用性以 Key 所属分组为准。',
    ),
  ),
  ...['wan2.7-t2v', 'wan2.7-i2v'].map((model) =>
    preset(
      `openlux-${model}`,
      `OpenLux · ${model}`,
      'openlux-wan',
      'https://api.openlux.ai',
      model,
      videoOptions({
        generationTypes: [
          model.endsWith('t2v') ? 'text_to_video' : 'image_to_video',
        ],
        durations: [5, 10],
        resolutions: ['720p', '1080p'],
        frameModes: ['first_frame'],
      }),
      'https://doc.openlux.ai/en/reference',
      [],
      '使用 alibailian 路由，API Key 与模型权限以控制台为准。',
    ),
  ),
  preset(
    'openlux-omni',
    'OpenLux · Omni Flash',
    'openlux-omni',
    'https://api.openlux.ai',
    'omni-flash',
    videoOptions({
      generationTypes: allModes,
      references: refs(3, 0, 0),
      durations: [8],
    }),
    'https://doc.openlux.ai/en/reference/omni',
    [],
    '使用统一 video/create 与 video/query 路由。',
  ),
  {
    ...preset(
      'leaderai-custom',
      'LeaderAI · 自定义视频端点',
      'openai-video',
      'https://www.leaderai.top/v1',
      '请填写控制台视频模型ID',
      videoOptions({ generationTypes: ['text_to_video'], maxImages: 0 }),
      'https://www.leaderai.top',
      [],
      '尚未找到可核验的视频协议文档。请确认 API Base、协议和模型 ID 后启用，不能按聊天接口推断视频兼容性。',
    ),
    enabled: false,
    needsReview: true,
  },
  preset(
    'gemini-omni',
    'Google 官方 · Gemini Omni Flash',
    'gemini',
    'https://generativelanguage.googleapis.com/v1beta',
    'gemini-omni-1.1-flash',
    videoOptions({
      generationTypes: allModes,
      durations: [8],
      resolutions: ['360p', '720p', '1080p', '4k'],
      references: refs(6, 0, 0),
      aspectRatios: ['16:9', '9:16'],
      maxImages: 6,
      frameModes: ['first_frame'],
    }),
    'https://ai.google.dev/gemini-api/docs/omni',
    ['generativelanguage.googleapis.com'],
    '使用 URI delivery；时长通过提示词表达，以实际返回为准。Veo 3.1 Preview 已停用。',
  ),
  ...[
    'grok-imagine-video',
    'grok-imagine-video-1.5',
    'grok-imagine-video-1.5-lite',
  ].map((model) =>
    preset(
      `xai-${model}`,
      `Grok 官方 · ${model}`,
      'xai',
      'https://api.x.ai/v1',
      model,
      videoOptions({
        generationTypes: model.endsWith('lite')
          ? ['text_to_video', 'image_to_video']
          : allModes,
        durations: range(1, 15),
        resolutions: model.includes('1.5')
          ? ['720p', '1080p']
          : ['480p', '720p'],
        aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'],
        frameModes:
          model === 'grok-imagine-video-1.5'
            ? ['first_frame', 'first_last_frame']
            : ['first_frame'],
        references: model.endsWith('lite')
          ? undefined
          : refs(model.includes('1.5') ? 14 : 7, 0, 0),
      }),
      'https://docs.x.ai/developers/model-capabilities/video/generation',
      ['vidgen.x.ai'],
    ),
  ),
  ...[
    'minimax-h3:standard',
    'minimax-h3:highspeed',
    'minimax-h3-comfy:turbo',
    'seedance:v2',
    'seedance:v2-fast',
    'seedance:v2.5',
    'wan:v3.0',
  ].map((model) =>
    preset(
      `civitai-${model.replace(':', '-')}`,
      `Civitai red · ${model}`,
      'civitai',
      'https://orchestration.civitai.com/v2/consumer',
      model,
      videoOptions({
        generationTypes: model.startsWith('seedance:')
          ? ['text_to_video', 'reference_to_video']
          : model.startsWith('wan:')
            ? ['text_to_video', 'image_to_video']
            : allModes,
        durations: range(5, model.endsWith('v2.5') ? 30 : 15),
        resolutions: model.startsWith('minimax-h3:')
          ? model.endsWith('highspeed')
            ? ['768P']
            : ['480P', '768P', '2K']
          : model.includes('comfy')
            ? ['480p']
            : ['480p', '720p', '1080p'],
        aspectRatios: ratios,
        references: model.includes('comfy') ? refs(9, 0, 0) : refs(),
      }),
      'https://orchestration.civitai.com/openapi/v2-consumers.json',
      [],
      'Civitai red 使用同一编排 API 和你的 API Key；成熟内容开关需单独选择。',
    ),
  ),
  {
    ...preset(
      'fasth3-custom',
      'FastH3 · 自定义兼容服务',
      'fastvideo',
      'https://请填写服务地址.example/v1',
      'fasth3',
      videoOptions({
        generationTypes: ['text_to_video'],
        maxImages: 0,
        durations: [5],
        resolutions: ['768p'],
        aspectRatios: ['16:9'],
        frameModes: undefined,
      }),
      'https://github.com/hao-ai-lab/FastVideo/blob/main/docs/cookbook/openai-api.md',
      [],
      'FastH3 不等同于 H3 HighSpeed。需填写实际服务地址和模型目录中的 ID 后启用。',
    ),
    enabled: false,
    needsReview: true,
  },
]

// Keep separate presets only where the wire protocol or API base differs.
export const VIDEO_ENDPOINT_PRESETS: VideoEndpointPreset[] = [
  ...new Map(
    VIDEO_MODEL_CATALOG.map((model) => [
      `${model.protocol}|${model.baseURL}`,
      VIDEO_MODEL_CATALOG.find(
        (candidate) =>
          candidate.protocol === model.protocol &&
          candidate.baseURL === model.baseURL,
      )!,
    ]),
  ).values(),
].map((model) => ({
  ...model,
  name:
    model.protocol === 'ark'
      ? model.baseURL.includes('laozhang')
        ? '老张 · Seedance / Ark'
        : 'OpenLux · Seedance / Ark'
      : (
          {
            spicy: 'SpicyAPI',
            openrouter: 'OpenRouter',
            venice: 'Venice',
            'laozhang-wan': '老张 · Wan',
            'openlux-minimax': 'OpenLux · MiniMax V2',
            'openlux-wan': 'OpenLux · Wan',
            'openlux-omni': 'OpenLux · Omni',
            gemini: 'Google Gemini 官方',
            xai: 'Grok 官方',
            civitai: 'Civitai red',
            'openai-video': 'LeaderAI · 自定义视频端点',
            fastvideo: 'FastH3 · 自定义兼容服务',
          } as Partial<Record<VideoProtocol, string>>
        )[model.protocol] || model.name,
}))

export const videoModelDiscoverySchema = videoEndpointSchema
  .pick({
    id: true,
    baseURL: true,
    protocol: true,
    apiKey: true,
  })
  .extend({ options: videoEndpointSchema.shape.options.optional() })
