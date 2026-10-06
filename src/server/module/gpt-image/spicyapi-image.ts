import fs from 'fs-extra'
import path from 'path'
import type { SpicyLora } from '../../../shared/spicyapi'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { taskManager } from '../../common/task-manager'
import type { TaskTemplate } from '../../common/template-manager'
import { logger } from '../utils/logger'
import type { GptImageQuality, GptImageSize } from './enum'
import { getImageMimeType, persistImages } from './image-files'
import { buildPromptWithAspectRatio } from './index'
import {
  buildSpicyImageBody,
  generateSpicyImage,
  getSpicyModel,
  uploadSpicyImage,
} from './spicyapi-api'

export async function handleSpicyImageGeneration(options: {
  apiKey: string
  baseURL: string
  model: string
  editModel?: string
  template: TaskTemplate
  size: GptImageSize
  quality: GptImageQuality
  endpointName?: string
  originalPrompt?: string
  writeMetadata?: boolean
  spicyLoras?: SpicyLora[]
  spicySeed?: number
  spicyResolution?: '1k' | '1.5k' | '2k'
}) {
  const {
    template,
    size,
    quality,
    endpointName,
    originalPrompt,
    writeMetadata = true,
  } = options
  const model = template.images.length
    ? options.editModel || options.model
    : options.model
  const task = await taskManager.createTaskFromTemplate({
    template,
    source: model,
    size,
    quality,
    endpointName,
    originalPrompt,
  })
  if (!task)
    return {
      status: 500,
      data: { success: false as const, error: '[服务] Failed to create task' },
    }
  await taskManager.updateTaskStatus(task.id, 'running')
  await taskManager.updateTask(task.id, { providerQuality: 'auto' })
  const startedAt = Date.now()
  const requestIds: string[] = []
  const filenames: string[] = []
  const failures: string[] = []
  const costs: Array<number | undefined> = []
  try {
    const record = await getSpicyModel(options.baseURL, options.apiKey, model)
    const prompt = buildPromptWithAspectRatio(template)
    const body = buildSpicyImageBody({
      model,
      record,
      prompt,
      aspectRatio: template.aspectRatio || '1:1',
      resolution: options.spicyResolution || size,
      images: template.images,
      loras: options.spicyLoras,
      seed: options.spicySeed,
    })
    const images = await Promise.all(
      template.images.map(async (url) => {
        const imagePath = path.join(INPUT_IMAGES_DIR, path.basename(url))
        if (!(await fs.pathExists(imagePath)))
          throw new Error('SpicyAPI 参考图文件不存在')
        const contentType = getImageMimeType(imagePath)
        const imageSpec =
          record.inputSchema.properties.image_urls ||
          record.inputSchema.properties.image_url
        const acceptedTypes =
          imageSpec?.items?.contentMediaType || imageSpec?.contentMediaType
        if (
          Array.isArray(acceptedTypes) &&
          !acceptedTypes.includes(contentType)
        )
          throw new Error('SpicyAPI 当前模型不支持该参考图格式')
        return uploadSpicyImage({
          ...options,
          contentType,
          bytes: await fs.readFile(imagePath),
          maxBytes: imageSpec?.['x-ui']?.max_size_mb
            ? imageSpec['x-ui'].max_size_mb * 1024 * 1024
            : undefined,
        })
      }),
    )
    if (images.length) {
      if (body.input.image_urls) body.input.image_urls = images
      else body.input.image_url = images[0]
    }
    const metadata = writeMetadata
      ? {
          prompt,
          originalPrompt,
          model,
          engine: 'spicyapi-images',
          title: template.title,
          endpointName,
          requestedSize: options.spicyResolution || size,
          aspectRatio: template.aspectRatio || '1:1',
          quality: 'auto',
          referenceImageCount: images.length,
          generatedAt: new Date().toISOString(),
        }
      : undefined
    const requestedCount = Math.max(1, template.n || 1)
    for (let index = 0; index < requestedCount; index++) {
      try {
        const result = await generateSpicyImage({
          ...options,
          body,
          onPrepared: async (key) => {
            requestIds.push('idempotency:' + key)
            await taskManager.updateTask(task.id, {
              imageBilling: {
                status: 'pending',
                currency: 'USD',
                source: 'provider-response',
                requestIds: [...requestIds],
              },
            })
          },
          onSubmitted: async (id) => {
            requestIds.push(id)
            await taskManager.updateTask(task.id, {
              imageBilling: {
                status: 'pending',
                currency: 'USD',
                source: 'provider-response',
                requestIds: [...requestIds],
              },
            })
          },
        })
        costs.push(result.cost)
        const persisted = await persistImages(result.urls, metadata)
        if (!persisted.length)
          throw new Error(`SpicyAPI 任务 ${result.taskId} 图片下载或保存失败`)
        filenames.push(...persisted)
        // Save each completed request promptly; signed result URLs expire.
        await taskManager.updateTask(task.id, {
          outputUrls: filenames.map(
            (name) => `${GENERATED_IMAGES_API_PATH}/${name}`,
          ),
        })
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (!filenames.length) throw new Error(failures[0] || 'SpicyAPI 未返回图片')
    const completeCost =
      failures.length === 0 &&
      costs.length === requestedCount &&
      costs.every((cost) => cost !== undefined)
    const outputUrls = filenames.map(
      (name) => `${GENERATED_IMAGES_API_PATH}/${name}`,
    )
    await taskManager.updateTask(task.id, {
      status: 'completed',
      duration: Date.now() - startedAt,
      outputUrls,
      ...(failures.length
        ? {
            error: `部分生成失败 (${failures.length}/${requestedCount})：${failures.join('; ')}`,
          }
        : {}),
      imageBilling: {
        status: completeCost ? 'actual' : 'unavailable',
        currency: 'USD',
        source: 'provider-response',
        requestIds,
        ...(completeCost
          ? {
              cost: costs.reduce<number>(
                (total, cost) => total + (cost ?? 0),
                0,
              ),
            }
          : {}),
      },
    })
    if (failures.length)
      logger.warn(`SpicyAPI 部分生成失败：${failures.join('; ')}`)
    return {
      status: 200,
      data: { success: true as const, outputUrls, taskId: task.id },
    }
  } catch (error) {
    const message = `[SpicyAPI] ${error instanceof Error ? error.message : String(error)}`
    logger.error('SpicyAPI image generation failed', message)
    await taskManager.updateTask(task.id, {
      status: 'failed',
      error: message,
      duration: Date.now() - startedAt,
      imageBilling: {
        status: 'unavailable',
        currency: 'USD',
        source: 'provider-response',
        requestIds,
      },
    })
    return { status: 500, data: { success: false as const, error: message } }
  }
}
