import fs from 'fs-extra'
import path from 'path'
import { normalizeGeminiModel } from '../../../shared/gemini'
import type { GptImageEndpoint } from '../../common/config'
import { INPUT_IMAGES_DIR } from '../../common/static'
import { GENERATED_IMAGES_API_PATH } from '../../common/static/enum'
import { taskManager } from '../../common/task-manager'
import type { TaskTemplate } from '../../common/template-manager'
import { logger } from '../utils/logger'
import { summarizeProviderImageUsage } from './billing'
import {
  GPT_IMAGE_OUTPUT_MAX_N,
  type GptImageQuality,
  type GptImageSize,
} from './enum'
import {
  buildGeminiImageRequest,
  generateGeminiImage,
  GeminiApiError,
} from './gemini-api'
import { persistImageBuffers } from './image-files'
import { buildPromptWithAspectRatio } from './index'

export async function handleGeminiImageGeneration(options: GptImageEndpoint & {
  template: TaskTemplate
  size: GptImageSize
  quality: GptImageQuality
  endpointName?: string
  originalPrompt?: string
  folderId?: string
  writeMetadata?: boolean
}) {
  const {
    template, size, quality, endpointName, originalPrompt, writeMetadata = true,
  } = options
  // Validate and prepare every reference before creating a task or submitting a paid call.
  let request: Awaited<ReturnType<typeof buildGeminiImageRequest>>
  let model: string
  const count = template.n ?? 1
  try {
    if (!Number.isInteger(count) || count < 1 || count > GPT_IMAGE_OUTPUT_MAX_N)
      throw new GeminiApiError(`图片数量必须是 1–${GPT_IMAGE_OUTPUT_MAX_N} 的整数`, 400)
    model = normalizeGeminiModel(
      template.images.length ? options.editModel || options.model : options.model,
    )
    const imagePaths = await Promise.all(
      template.images.map(async (url) => {
        const filename = path.join(INPUT_IMAGES_DIR, path.basename(url))
        if (!(await fs.pathExists(filename)))
          throw new GeminiApiError('参考图文件不存在', 400)
        return filename
      }),
    )
    request = await buildGeminiImageRequest({
      ...options,
      model,
      size,
      imagePaths,
      prompt: buildPromptWithAspectRatio(template),
      aspectRatio: template.aspectRatio || '1:1',
    })
    if (!options.apiKey.trim()) throw new GeminiApiError('Gemini API Key 未配置', 400)
  } catch (error) {
    return {
      status: 400,
      data: {
        success: false as const,
        error: `[Gemini API] ${error instanceof Error ? error.message : String(error)}`,
      },
    }
  }
  const task = await taskManager.createTaskFromTemplate({
    template,
    source: model,
    size,
    quality,
    endpointName,
    originalPrompt,
    folderId: options.folderId,
  })
  if (!task) return {
    status: 500,
    data: { success: false as const, error: '[服务] Failed to create task' },
  }
  const start = Date.now()
  const filenames: string[] = []
  const usages: Array<Record<string, unknown> | undefined> = []
  const requestIds: string[] = []
  const failures: string[] = []
  let failureStatus = 500
  await taskManager.updateTask(task.id, { status: 'running', providerQuality: 'auto' })
  const metadata = writeMetadata ? {
    title: template.title,
    prompt: buildPromptWithAspectRatio(template),
    originalPrompt,
    model,
    engine: 'gemini-images',
    endpointName,
    requestedSize: size,
    aspectRatio: template.aspectRatio || '1:1',
    quality: 'auto',
    referenceImageCount: template.images.length,
    generatedAt: new Date().toISOString(),
  } : undefined
  try {
    for (let index = 0; index < count; index++) {
      try {
        const result = await generateGeminiImage(request, options.apiKey)
        usages.push(result.usage)
        if (result.responseId) requestIds.push(result.responseId)
        const saved = await persistImageBuffers(result.buffers, metadata)
        if (!saved.length) throw new Error('Gemini 返回的图片无法保存')
        filenames.push(...saved)
        await taskManager.updateTask(task.id, {
          outputUrls: filenames.map((name) => `${GENERATED_IMAGES_API_PATH}/${name}`),
        })
      } catch (error) {
        if (!failures.length && error instanceof GeminiApiError) failureStatus = error.status
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (!filenames.length)
      throw new GeminiApiError(failures[0] || 'Gemini 未返回图片', failureStatus)
    const outputUrls = filenames.map((name) => `${GENERATED_IMAGES_API_PATH}/${name}`)
    const { usage } = summarizeProviderImageUsage(usages)
    await taskManager.updateTask(task.id, {
      status: 'completed',
      duration: Date.now() - start,
      outputUrls,
      ...(usage ? { gptTokenUsage: usage } : {}),
      ...(failures.length
        ? { error: `部分生成失败 (${failures.length}/${count})：${failures.join('; ')}` }
        : {}),
      imageBilling: { status: 'unavailable', currency: 'USD', requestIds },
    })
    return {
      status: 200,
      data: { success: true as const, outputUrls, taskId: task.id, usage },
    }
  } catch (error) {
    const message = `[Gemini API] ${error instanceof Error ? error.message : String(error)}`
    logger.error('Gemini image generation failed', message)
    await taskManager.updateTask(task.id, {
      status: 'failed',
      duration: Date.now() - start,
      error: message,
      imageBilling: { status: 'unavailable', currency: 'USD', requestIds },
    })
    return {
      status: error instanceof GeminiApiError ? error.status : 500,
      data: { success: false as const, error: message },
    }
  }
}
