import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import {
  STUDIO_MAX_FILE_BYTES,
  studioSourceLabel,
  type StudioItem,
  type StudioProvenance,
} from '../../shared/studio'
import {
  embedPngTextMetadata,
  readPngGenerationText,
} from '../module/gpt-image/generation-metadata'
import { getDataDir } from './data-dir'
import { SafeJsonStore } from './safe-json-store'
import type { NovelAIGenerationSnapshot } from '../../shared/studio-generation'
import { GENERATED_IMAGES_DIR, INPUT_IMAGES_DIR } from './static'
import { GENERATED_IMAGES_API_PATH, INPUT_IMAGES_API_PATH } from './static/enum'
import { taskManager, type Task } from './task-manager'

interface StudioDocument {
  id: string
  provenance: StudioProvenance
  createdAt: number
}
interface StudioState {
  items: StudioItem[]
  documents: StudioDocument[]
}

export function detectStudioFormat(buffer: Buffer): StudioItem['format'] {
  if (buffer.length > STUDIO_MAX_FILE_BYTES)
    throw new Error('文件不能超过 64 MiB')
  if (buffer.length < 12) throw new Error('文件为空或格式不受支持')
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png'
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpeg'
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp'
  if (/^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'gif'
  if (buffer.toString('ascii', 0, 4) === '8BPS' && buffer.readUInt16BE(4) === 1)
    return 'psd'
  throw new Error('支持 PNG、JPEG、WebP、GIF 和 PSD 文件')
}

export const studioMimeType = (format: StudioItem['format']) =>
  format === 'psd' ? 'image/vnd.adobe.photoshop' : `image/${format}`
const extension = (format: StudioItem['format']) =>
  format === 'jpeg' ? 'jpg' : format
const safeName = (name: string, format: StudioItem['format']) =>
  `${
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .trim()
      .slice(0, 120) || '未命名'
  }.${extension(format)}`

/** All file transfers and shelf mutations share one queue, including pin/empty. */
export class StudioManager {
  private root = path.join(getDataDir(), 'studio')
  private files = path.join(this.root, 'files')
  private store = new SafeJsonStore<StudioState>(
    path.join(this.root, 'index.json'),
  )
  private queue: Promise<unknown> = Promise.resolve()

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => {})
    return next
  }

  private async read(): Promise<StudioState> {
    await fs.ensureDir(this.files)
    const state = await this.store.read()
    if (state) return state
    if (await fs.pathExists(path.join(this.root, 'index.json')))
      throw new Error('暂存台索引无法读取，已保留文件，请检查服务日志')
    return { items: [], documents: [] }
  }

  private filePath(item: StudioItem) {
    if (!/^[\da-f-]{36}$/i.test(item.id)) throw new Error('无效的素材编号')
    return path.join(this.files, `${item.id}.${extension(item.format)}`)
  }

  private find(state: StudioState, id: string) {
    const item = state.items.find((entry) => entry.id === id)
    if (!item) throw new Error('素材不存在，可能已被清理')
    return item
  }

  list() {
    return this.run(async () => (await this.read()).items)
  }

  file(id: string) {
    return this.run(async () => {
      const item = this.find(await this.read(), id)
      return { item, buffer: await fs.readFile(this.filePath(item)) }
    })
  }

  private async add(
    state: StudioState,
    buffer: Buffer,
    name: string,
    provenance: StudioProvenance,
  ) {
    const format = detectStudioFormat(buffer)
    const item: StudioItem = {
      id: uuidv4(),
      name: safeName(name, format),
      format,
      bytes: buffer.length,
      createdAt: Date.now(),
      pinned: false,
      provenance,
    }
    if (format === 'png') {
      buffer = embedPngTextMetadata(
        buffer,
        'openLinAIStudio',
        JSON.stringify({
          schema: 'openlinai.studio.v1',
          name: item.name,
          savedAt: item.createdAt,
          provenance,
        }),
      )
      item.bytes = buffer.length
    }
    await fs.writeFile(this.filePath(item), buffer, { flag: 'wx' })
    state.items.unshift(item)
    try {
      await this.store.write(state)
    } catch (error) {
      await fs.unlink(this.filePath(item)).catch(() => {})
      throw error
    }
    return item
  }

  upload(buffer: Buffer, name: string, documentId?: string) {
    return this.run(async () => {
      const state = await this.read()
      const document = documentId
        ? state.documents.find((entry) => entry.id === documentId)
        : undefined
      if (documentId && !document)
        throw new Error('文档来源记录不存在，请重新打开素材')
      return this.add(
        state,
        buffer,
        name,
        document?.provenance || { origin: 'import' },
      )
    })
  }

  fromCivitai(buffer: Buffer, snapshot: NonNullable<StudioProvenance['civitai']>) {
    return this.run(async () => {
      const state = await this.read()
      // Recover safely even if the process stopped after the shelf write.
      const existing = state.items.find((item) => item.provenance.civitai?.workflowId === snapshot.workflowId && item.provenance.civitai.imageIndex === snapshot.imageIndex)
      if (existing) return existing
      return this.add(state, buffer, `Civitai-${snapshot.imageIndex + 1}.png`, {
        origin: 'civitai', model: snapshot.request.model.name, civitai: snapshot,
        template: { id: uuidv4(), title: 'Civitai Studio', prompt: snapshot.request.prompt, images: [], usageType: 'image', aspectRatio: `${snapshot.request.width}:${snapshot.request.height}`, n: 1, createdAt: Date.now() },
        sourceMetadata: readPngGenerationText(buffer),
      })
    })
  }

  fromInpaintRaw(buffer: Buffer, snapshot: NovelAIGenerationSnapshot) {
    return this.run(async () => this.add(
      await this.read(),
      buffer,
      `${snapshot.request.title || 'NovelAI'}-${snapshot.imageIndex + 1}-上游原始结果.png`,
      {
        origin: 'novelai',
        model: snapshot.request.model,
        novelai: snapshot,
        inpaintRaw: true,
        sourceMetadata: readPngGenerationText(buffer),
      },
    ))
  }

  fromTask(taskId: string, imageIndex: number, addedFromTask = false) {
    return this.run(async () => {
      const task = (await taskManager.getTasks()).find(
        (entry) => entry.id === taskId,
      )
      if (!task) throw new Error('原任务不存在')
      const url = (
        task.outputUrls?.length
          ? task.outputUrls
          : task.outputUrl
            ? [task.outputUrl]
            : []
      )[imageIndex]
      const prefix = `${GENERATED_IMAGES_API_PATH}/`
      if (!url?.startsWith(prefix))
        throw new Error('原任务没有可复制的本地图片')
      const filename = url.slice(prefix.length)
      if (
        !filename ||
        path.basename(filename) !== filename ||
        /[\\/?#]/.test(filename)
      )
        throw new Error('原图片路径无效')
      const template = task.rawTemplate
      // Whitelist the snapshot: endpoint configuration and credentials never enter metadata.
      const buffer = await fs.readFile(
        path.join(GENERATED_IMAGES_DIR, filename),
      )
      const provenance: StudioProvenance = task.studioProvenance ? {
        ...task.studioProvenance,
        addedFromTask,
        novelai: task.novelaiSnapshots?.[imageIndex] || task.studioProvenance.novelai,
        sourceMetadata: readPngGenerationText(buffer),
        template: task.studioProvenance.template || {
          id: template.id,
          title: template.title,
          prompt: template.prompt,
          images: [...(template.images || [])],
          createdAt: template.createdAt,
          usageType: template.usageType,
          endpointId: template.endpointId,
          aspectRatio: template.aspectRatio,
          injectAspectRatio: template.injectAspectRatio,
          n: template.n,
        },
      } : {
        origin: /novelai/i.test(task.endpointName || task.source)
          ? 'novelai'
          : /civitai/i.test(task.endpointName || task.source)
            ? 'civitai'
            : 'other',
        sourceTaskId: task.id,
        addedFromTask,
        model: task.source,
        endpointName: task.endpointName,
        sourceMetadata: readPngGenerationText(buffer),
        template: {
          id: template.id,
          title: template.title,
          prompt: template.prompt,
          images: [...(template.images || [])],
          createdAt: template.createdAt,
          usageType: template.usageType,
          endpointId: template.endpointId,
          aspectRatio: template.aspectRatio,
          injectAspectRatio: template.injectAspectRatio,
          n: template.n,
        },
      }
      return this.add(
        await this.read(),
        buffer,
        `${template.title || '任务图片'}-${imageIndex + 1}.${path.extname(filename).slice(1)}`,
        provenance,
      )
    })
  }

  document(itemId?: string, external = false) {
    return this.run(async () => {
      const state = await this.read()
      const provenance: StudioProvenance = itemId
        ? { ...this.find(state, itemId).provenance, photopea: 'edited' }
        : external
          ? { origin: 'import', photopea: 'edited' }
          : { origin: 'photopea', photopea: 'created' }
      const document = { id: uuidv4(), provenance, createdAt: Date.now() }
      // Source snapshots have no file dependency: clearing the shelf must not
      // remove the provenance of a document still open in Photopea.
      state.documents.push(document)
      await this.store.write(state)
      return document
    })
  }

  pin(id: string, pinned: boolean) {
    return this.run(async () => {
      const state = await this.read()
      this.find(state, id).pinned = pinned
      await this.store.write(state)
      return state.items
    })
  }

  remove(ids: string[], unpinnedOnly: boolean) {
    return this.run(async () => {
      const state = await this.read()
      const selected = new Set(ids)
      const targets = state.items.filter(
        (item) => selected.has(item.id) && (!unpinnedOnly || !item.pinned),
      )
      // Unlink only controlled individual files. Keep failed entries visible.
      const removed = new Set<string>()
      let failure: unknown
      for (const item of targets) {
        try {
          await fs.unlink(this.filePath(item))
          removed.add(item.id)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            removed.add(item.id)
          else failure = error
        }
      }
      state.items = state.items.filter((item) => !removed.has(item.id))
      await this.store.write(state)
      if (failure) throw failure
      return { items: state.items, removed: removed.size }
    })
  }

  reference(id: string) {
    return this.run(async () => {
      const item = this.find(await this.read(), id)
      if (item.format === 'psd')
        throw new Error('请先从 Photopea 保存 PNG 成图，再作为参考图使用')
      const filename = `studio-${uuidv4()}.${extension(item.format)}`
      await fs.copyFile(
        this.filePath(item),
        path.join(INPUT_IMAGES_DIR, filename),
      )
      return { url: `${INPUT_IMAGES_API_PATH}/${filename}` }
    })
  }

  archive(id: string) {
    return this.run(async () => {
      const state = await this.read()
      const item = this.find(state, id)
      if (item.format === 'psd')
        throw new Error('任务列表保存图片，请先保存 PNG 成图')
      const tasks = await taskManager.getTasks()
      const existing = tasks.find((task) => task.studioItemId === id)
      if (existing) return { taskId: existing.id }
      const filename = `studio-${uuidv4()}.${extension(item.format)}`
      const destination = path.join(GENERATED_IMAGES_DIR, filename)
      await fs.copyFile(this.filePath(item), destination)
      const provenance = item.provenance
      const task: Task = {
        id: uuidv4(),
        status: 'completed',
        createdAt: Date.now(),
        source: provenance.model || provenance.origin,
        endpointName: studioSourceLabel(provenance),
        rawTemplate: provenance.template || {
          id: '',
          title: item.name,
          prompt: '',
          images: [],
          usageType: 'image',
          createdAt: item.createdAt,
        },
        outputUrls: [`${GENERATED_IMAGES_API_PATH}/${filename}`],
        studioItemId: id,
        studioProvenance: provenance,
      }
      try {
        await taskManager.addCompletedTask(task)
      } catch (error) {
        await fs.unlink(destination).catch(() => {})
        throw error
      }
      item.archivedTaskId = task.id
      await this.store.write(state)
      return { taskId: task.id }
    })
  }
}

export const studioManager = new StudioManager()
