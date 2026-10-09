import { z } from 'zod'
import { taskFolderNameSchema } from './task-folders'

export const TASK_BACKUP_MAX_BYTES = 512 * 1024 * 1024
export const TASK_BACKUP_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
export const TASK_BACKUP_STREAM_MAX_BYTES = 16 * 1024 * 1024 * 1024
export const TASK_BACKUP_STREAM_MAX_EXPANDED_BYTES = 32 * 1024 * 1024 * 1024
export const TASK_BACKUP_MAX_FILE_BYTES = 64 * 1024 * 1024
export const TASK_BACKUP_MANIFEST = 'task-list.json'

const id = z.string().min(1).max(200)
const timestamp = z.number().finite().nonnegative()
const templateSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    endpointId: z.string().optional(),
    prompt: z.string(),
    images: z.array(z.string()),
    usageType: z.enum(['image', 'chat-image']),
    createdAt: timestamp,
    aspectRatio: z.string().optional(),
    injectAspectRatio: z.boolean().optional(),
    gpt2QualityOptimization: z.boolean().optional(),
    generationLanguage: z.enum(['zh-CN', 'en-US']).optional(),
    n: z.number().finite().optional(),
  })
  .passthrough()

const endpointSchema = z
  .object({
    id,
    name: z.string(),
    baseURL: z.string(),
    model: z.string(),
    editModel: z.string().optional(),
    apiKey: z.string(),
    type: z.enum(['yunwu', 'openrouter', 'venice', 'laozhang', 'custom']),
    engine: z
      .enum([
        'openai-images',
        'openrouter-images',
        'venice-images',
        'novelai-images',
        'apimart-images',
        'spicyapi-images',
        'laozhang-images',
        'gemini-images',
        'chat-completions',
      ])
      .optional(),
    disabled: z.boolean().optional(),
    balanceAccessToken: z.string().optional(),
    balanceEnabled: z.boolean().optional(),
    balanceApiPath: z.string().optional(),
    balanceResultJsonKey: z.string().optional(),
    groupRatio: z.number().finite().nonnegative().optional(),
    laozhangGptImage2Mode: z.enum(['per-call', 'official']).optional(),
    laozhangQuality: z
      .enum(['low', 'medium', 'high', 'xhigh', 'max'])
      .optional(),
    laozhangTransparentBackground: z.boolean().optional(),
    geminiSafetySettings: z.record(z.string(), z.string()).optional(),
    spicyLoras: z
      .array(z.object({ path: z.string(), scale: z.number().finite() }))
      .optional(),
    spicySeed: z.number().finite().optional(),
    spicyResolution: z.enum(['1k', '1.5k', '2k']).optional(),
  })
  .passthrough()

export const taskBackupSchema = z.object({
  format: z.literal('openlinai.task-list-backup'),
  version: z.literal(1),
  createdAt: timestamp,
  tasks: z
    .array(
      z
        .object({
          id,
          folderId: z.string().optional(),
          rawTemplate: templateSchema,
          source: z.string(),
          status: z.enum(['pending', 'running', 'completed', 'failed']),
          createdAt: timestamp,
          originalPrompt: z.string().optional(),
          endpointName: z.string().optional(),
          outputUrl: z.string().optional(),
          outputUrls: z.array(z.string()).optional(),
        })
        .passthrough(),
    )
    .max(10000),
  folders: z.array(z.object({ id, name: taskFolderNameSchema })).max(10000),
  endpoints: z.array(endpointSchema).max(1000),
  downloadedTaskIds: z.array(id).max(10000),
  assets: z
    .array(
      z.object({
        url: z.string().min(1),
        path: z
          .string()
          .regex(
            /^assets\/[\da-f]{64}\.(png|jpg|jpeg|webp|gif|avif|tif|tiff|bmp|svg|psd)$/,
          ),
        bytes: z.number().int().positive().max(TASK_BACKUP_MAX_FILE_BYTES),
        sha256: z.string().regex(/^[\da-f]{64}$/),
      }),
    )
    .max(30000),
  studioItems: z
    .array(
      z
        .object({
          id: z.uuid(),
          name: z.string(),
          format: z.enum(['png', 'jpeg', 'webp', 'gif', 'psd']),
          bytes: z.number().int().nonnegative(),
          createdAt: timestamp,
          pinned: z.boolean(),
          provenance: z
            .object({
              origin: z.enum([
                'photopea',
                'novelai',
                'civitai',
                'import',
                'other',
              ]),
            })
            .passthrough(),
          archivedTaskId: z.string().optional(),
        })
        .passthrough(),
    )
    .max(10000),
})

export type TaskBackup = z.infer<typeof taskBackupSchema>

/** Visit only image fields, preserving prompt text even when it looks like a URL. */
export function mapBackupImageUrls(
  value: unknown,
  map: (url: string) => string,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => mapBackupImageUrls(item, map))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (['images', 'outputUrls'].includes(key) && Array.isArray(item))
        return [
          key,
          item.map((url) => (typeof url === 'string' ? map(url) : url)),
        ]
      if (
        ['outputUrl', 'imageUrl', 'referenceImageUrl', 'maskImageUrl'].includes(
          key,
        ) &&
        typeof item === 'string'
      )
        return [key, map(item)]
      return [key, mapBackupImageUrls(item, map)]
    }),
  )
}
