import { z } from 'zod'

export const COMFY_VIDEO_SOURCES = [
  'prompt',
  'image',
  'durationSeconds',
  'width',
  'height',
  'frameCount',
  'fps',
  'seed',
  'resolution',
  'aspectRatio',
] as const

export const comfyVideoSchema = z
  .object({
    workflow: z
      .record(
        z.string().min(1).max(200),
        z.object({
          class_type: z.string().min(1).max(200),
          inputs: z.record(z.string(), z.unknown()),
          _meta: z
            .object({ title: z.string().optional() })
            .passthrough()
            .optional(),
        }),
      )
      .refine(
        (value) =>
          Object.keys(value).length > 0 &&
          Object.keys(value).length <= 2000 &&
          new TextEncoder().encode(JSON.stringify(value)).length <=
            2 * 1024 * 1024,
        '请导入 ComfyUI 导出的 API 格式工作流（非画布 JSON）',
      ),
    bindings: z
      .array(
        z.object({
          nodeId: z.string().min(1).max(200),
          input: z.string().min(1).max(200),
          source: z.enum(COMFY_VIDEO_SOURCES),
          imageIndex: z.number().int().min(0).max(15).optional(),
        }),
      )
      .min(1)
      .max(200),
    outputNodeId: z.string().max(200).optional(),
    fps: z.number().min(1).max(120).default(24),
    frameCountOffset: z.number().int().min(-1).max(1).default(1),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>()
    for (const [index, binding] of config.bindings.entries()) {
      const node = config.workflow[binding.nodeId]
      const key = JSON.stringify([binding.nodeId, binding.input])
      if (
        !node?.inputs ||
        !Object.prototype.hasOwnProperty.call(node.inputs, binding.input) ||
        Array.isArray(node.inputs[binding.input]) ||
        seen.has(key)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['bindings', index],
          message: '映射必须指向已有的非连线输入，同一输入不能重复映射',
        })
      seen.add(key)
    }
    if (!config.bindings.some((binding) => binding.source === 'prompt'))
      ctx.addIssue({
        code: 'custom',
        path: ['bindings'],
        message: '请映射至少一个提示词输入',
      })
    if (config.outputNodeId && !config.workflow[config.outputNodeId])
      ctx.addIssue({
        code: 'custom',
        path: ['outputNodeId'],
        message: '视频输出节点不存在',
      })
  })

export type ComfyVideoConfig = z.infer<typeof comfyVideoSchema>

export function videoConnectionIssue(value: {
  baseURL: string
  network?: string
}) {
  let url: URL
  try {
    url = new URL(value.baseURL)
  } catch {
    return '视频 API 地址无效'
  }
  if (
    value.network !== 'local' &&
    (url.protocol !== 'https:' || (url.port && url.port !== '443'))
  )
    return '公网视频 API 必须使用 HTTPS；本机或内网服务请选择内网连接'
}
