import fs from 'fs-extra'
import path from 'path'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { taskManager } from '../../common/task-manager'
import type { TaskTemplate } from '../../common/template-manager'
import { logger } from '../utils/logger'
import { buildAPIMartImageBody, generateAPIMartImage } from './apimart-api'
import type { GptImageQuality, GptImageSize } from './enum'
import { persistImages, readImageAsDataUrl } from './image-files'
import { buildPromptWithAspectRatio } from './index'

export async function handleAPIMartImageGeneration(options: {
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
  const startedAt = Date.now()
  const requestIds: string[] = []
  const filenames: string[] = []
  const failures: string[] = []
  const costs: Array<number | undefined> = []
  try {
    const images = await Promise.all(
      template.images.map(async (url) => {
        const imagePath = path.join(INPUT_IMAGES_DIR, path.basename(url))
        if (!(await fs.pathExists(imagePath)))
          throw new Error('APImart 参考图文件不存在')
        return readImageAsDataUrl(imagePath)
      }),
    )
    const prompt = buildPromptWithAspectRatio(template)
    const body = await buildAPIMartImageBody({
      ...options,
      model,
      prompt,
      aspectRatio: template.aspectRatio || '1:1',
      images,
    })
    const metadata = writeMetadata
      ? {
          prompt,
          originalPrompt,
          model,
          engine: 'apimart-images',
          title: template.title,
          endpointName,
          requestedSize: size,
          aspectRatio: template.aspectRatio || '1:1',
          quality,
          referenceImageCount: images.length,
          generatedAt: new Date().toISOString(),
        }
      : undefined
    const requestedCount = Math.max(1, template.n || 1)
    for (let index = 0; index < requestedCount; index++) {
      try {
        const result = await generateAPIMartImage({
          ...options,
          body,
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
          throw new Error(`APImart 任务 ${result.taskId} 图片下载或保存失败`)
        filenames.push(...persisted)
        // Save each completed request promptly; upstream URLs expire after 24 hours.
        await taskManager.updateTask(task.id, {
          outputUrls: filenames.map(
            (name) => `${GENERATED_IMAGES_API_PATH}/${name}`,
          ),
        })
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (!filenames.length) throw new Error(failures[0] || 'APImart 未返回图片')
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
      logger.warn(`APImart 部分生成失败：${failures.join('; ')}`)
    return {
      status: 200,
      data: { success: true as const, outputUrls, taskId: task.id },
    }
  } catch (error) {
    const message = `[APImart] ${error instanceof Error ? error.message : String(error)}`
    logger.error('APImart image generation failed', message)
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
