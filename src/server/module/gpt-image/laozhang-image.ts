import fs from 'fs-extra'
import path from 'path'
import {
  getLaoZhangImageFamily,
  normalizeLaoZhangModel,
} from '../../../shared/laozhang'
import type { GptImageEndpoint } from '../../common/config'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { taskManager } from '../../common/task-manager'
import type { TaskTemplate } from '../../common/template-manager'
import { logger } from '../utils/logger'
import type { GptImageQuality, GptImageSize } from './enum'
import { persistImages } from './image-files'
import { buildPromptWithAspectRatio } from './index'
import {
  buildLaoZhangImageRequest,
  generateLaoZhangImage,
} from './laozhang-api'

export async function handleLaoZhangImageGeneration(
  options: GptImageEndpoint & {
    template: TaskTemplate
    size: GptImageSize
    quality: GptImageQuality
    endpointName?: string
    originalPrompt?: string
    folderId?: string
    writeMetadata?: boolean
  },
) {
  const {
    template,
    size,
    quality,
    endpointName,
    originalPrompt,
    writeMetadata = true,
  } = options
  const model = normalizeLaoZhangModel(
    template.images.length ? options.editModel || options.model : options.model,
  )
  const task = await taskManager.createTaskFromTemplate({
    template,
    source: model,
    size,
    quality,
    endpointName,
    originalPrompt,
    folderId: options.folderId,
  })
  if (!task)
    return {
      status: 500,
      data: { success: false as const, error: '[服务] Failed to create task' },
    }
  const start = Date.now()
  const filenames: string[] = []
  const failures: string[] = []
  await taskManager.updateTaskStatus(task.id, 'running')
  try {
    const imagePaths = await Promise.all(
      template.images.map(async (url) => {
        const filename = path.join(INPUT_IMAGES_DIR, path.basename(url))
        if (!(await fs.pathExists(filename)))
          throw new Error('参考图文件不存在')
        return filename
      }),
    )
    const prompt = buildPromptWithAspectRatio(template)
    const request = {
      ...options,
      model,
      prompt,
      aspectRatio: template.aspectRatio || '1:1',
      imagePaths,
    }
    // Validate the whole batch before the first paid submission.
    const builtRequest = await buildLaoZhangImageRequest(request)
    const providerQuality =
      getLaoZhangImageFamily(model) === 'grok' && !imagePaths.length
        ? options.laozhangQuality || 'medium'
        : model === 'gpt-image-2.5-web' ||
            getLaoZhangImageFamily(model) !== 'gpt' ||
            (model === 'gpt-image-2' &&
              options.laozhangGptImage2Mode !== 'official')
          ? 'auto'
          : options.laozhangQuality || quality
    await taskManager.updateTask(task.id, { providerQuality })
    const metadata = writeMetadata
      ? {
          title: template.title,
          prompt,
          originalPrompt,
          model,
          engine: 'laozhang-images',
          endpointName,
          requestedSize: size,
          aspectRatio: template.aspectRatio || '1:1',
          quality: providerQuality,
          referenceImageCount: imagePaths.length,
          generatedAt: new Date().toISOString(),
        }
      : undefined
    const count = Math.max(1, template.n || 1)
    for (let index = 0; index < count; index++) {
      try {
        const saved = await persistImages(
          await generateLaoZhangImage(request, builtRequest),
          metadata,
        )
        if (!saved.length) throw new Error('老张返回的图片无法保存')
        filenames.push(...saved)
        await taskManager.updateTask(task.id, {
          outputUrls: filenames.map(
            (name) => `${GENERATED_IMAGES_API_PATH}/${name}`,
          ),
        })
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (!filenames.length) throw new Error(failures[0] || '老张未返回图片')
    const outputUrls = filenames.map(
      (name) => `${GENERATED_IMAGES_API_PATH}/${name}`,
    )
    await taskManager.updateTask(task.id, {
      status: 'completed',
      duration: Date.now() - start,
      outputUrls,
      ...(failures.length
        ? {
            error: `部分生成失败 (${failures.length}/${count})：${failures.join('; ')}`,
          }
        : {}),
      imageBilling: { status: 'unavailable', currency: 'USD', requestIds: [] },
    })
    return {
      status: 200,
      data: { success: true as const, outputUrls, taskId: task.id },
    }
  } catch (error) {
    const message = `[老张 API] ${error instanceof Error ? error.message : String(error)}`
    logger.error('LaoZhang image generation failed', message)
    await taskManager.updateTask(task.id, {
      status: 'failed',
      duration: Date.now() - start,
      error: message,
      imageBilling: { status: 'unavailable', currency: 'USD', requestIds: [] },
    })
    return { status: 500, data: { success: false as const, error: message } }
  }
}
