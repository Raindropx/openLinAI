import { assertInputImagesExist, generationSignal, cancelGenerationTask, registerGenerationTask, withImageLifecycle, checkGenerationCancelled } from '../image-lifecycle'
import { EventEmitter } from 'events'
import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { StudioProvenance } from '../../../shared/studio'
import type { NovelAIGenerationSnapshot } from '../../../shared/studio-generation'
import type { TaskListActions } from '../../../shared/task-list'
import type { VideoTask } from '../../../shared/video'
import {
  taskFolderNameSchema,
  type TaskFolder,
} from '../../../shared/task-folders'
import type { ImageBilling } from '../../module/gpt-image/billing'
import { GptImageQuality, GptImageSize } from '../../module/gpt-image/enum'
import { Logger } from '../../module/utils/logger'
import { getDataDir } from '../data-dir'
import { SafeJsonStore } from '../safe-json-store'
import { deleteUnreferencedImagesUnlocked } from '../static'
import { GENERATED_IMAGES_API_PATH } from '../static/enum'
import { TaskTemplate } from '../template-manager'

export interface Task {
  id: string
  mediaType?: 'image' | 'video'
  video?: VideoTask
  folderId?: string
  rawTemplate: TaskTemplate
  source: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  error?: string
  duration?: number
  outputUrl?: string
  outputUrls?: string[]
  createdAt: number
  size?: GptImageSize
  quality?: GptImageQuality
  /** Provider-specific effective quality, when it differs from the task setting. */
  providerQuality?: string
  /** 生成时使用的端点名快照（任务列表展示用） */
  endpointName?: string
  /** 采纳提示词优化结果前的本地文本，不参与生图请求 */
  originalPrompt?: string
  imageBilling?: ImageBilling
  studioItemId?: string
  studioProvenance?: StudioProvenance
  novelaiSnapshots?: NovelAIGenerationSnapshot[]
  /** Lightweight catalog records carry action availability without snapshots. */
  listActions?: TaskListActions
  [key: string]: any
}

export class TaskManager extends EventEmitter {
  private dataDir: string
  private tasksDbPath: string
  private logger: Logger
  private store: SafeJsonStore<Task[]>
  private folderStore: SafeJsonStore<TaskFolder[]>
  private folderQueue: Promise<unknown> = Promise.resolve()

  constructor() {
    super()
    this.dataDir = getDataDir()
    this.tasksDbPath = path.join(this.dataDir, 'tasks.json')
    this.logger = new Logger('task-manager')
    this.store = new SafeJsonStore<Task[]>(this.tasksDbPath)
    this.folderStore = new SafeJsonStore<TaskFolder[]>(
      path.join(this.dataDir, 'task-folders.json'),
    )
    this.init()
  }

  private init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }
    if (!fs.existsSync(this.tasksDbPath)) {
      fs.writeFileSync(this.tasksDbPath, JSON.stringify([]), 'utf-8')
      return
    }

    try {
      const data = fs.readFileSync(this.tasksDbPath, 'utf-8')
      const tasks: Task[] = JSON.parse(data)
      let changed = false
      for (const task of tasks) {
        if (task.imageBilling?.status === 'pending') {
          task.imageBilling.status = 'unavailable'
          changed = true
        }
        if (!task.video && (task.status === 'pending' || task.status === 'running')) {
          task.status = 'failed'
          task.error = '[服务] 连接已丢失'
          changed = true
        }
      }
      if (changed) {
        fs.writeFileSync(this.tasksDbPath, JSON.stringify(tasks), 'utf-8')
      }
    } catch (error) {
      // tasks.json 损坏：备份后重建空文件，避免服务卡死
      this.logger.error('tasks.json 解析失败，正在备份并重建:', error)
      this.store.backupCorruptFileSync()
      fs.writeFileSync(this.tasksDbPath, JSON.stringify([]), 'utf-8')
    }
  }

  private async notifyTasksUpdate(tasks?: Task[]) {
    try {
      if (!this.listenerCount('tasks-updated')) return
      const list = tasks ?? (await this.getTasks())
      this.emit('tasks-updated', list)
    } catch (error) {
      this.logger.error('Failed to notify tasks update:', error)
    }
  }

  public async getTasks(shared = false): Promise<Task[]> {
    const tasks = await this.store.read(shared)
    return tasks ?? []
  }

  public async getFolders(): Promise<TaskFolder[]> {
    return (await this.folderStore.read()) ?? []
  }

  // Serialize folder membership changes with creation/removal of folders.
  private withFolders<T>(action: () => Promise<T>): Promise<T> {
    const result = this.folderQueue.then(action)
    this.folderQueue = result.catch(() => {})
    return result
  }

  public async saveFolder(name: string, id?: string): Promise<TaskFolder> {
    return this.withFolders(async () => {
      const normalizedName = taskFolderNameSchema.parse(name)
      let folder!: TaskFolder
      await this.folderStore.mutate((list) => {
        if (
          list.some(
            (item) =>
              item.id !== id &&
              item.name.toLocaleLowerCase() ===
                normalizedName.toLocaleLowerCase(),
          )
        ) {
          throw new Error('文件夹已存在')
        }
        if (id) {
          const index = list.findIndex((item) => item.id === id)
          if (index < 0) throw new Error('文件夹不存在')
          folder = { id, name: normalizedName }
          list[index] = folder
        } else {
          folder = { id: uuidv4(), name: normalizedName }
          list.push(folder)
        }
        return list
      })
      await this.notifyTasksUpdate()
      return folder
    })
  }

  public async deleteFolder(id: string): Promise<void> {
    return this.withFolders(async () => {
      if (!(await this.getFolders()).some((folder) => folder.id === id))
        throw new Error('文件夹不存在')
      // Preserve tasks and images; if catalog writing fails, an empty folder remains.
      await this.store.mutate((list) =>
        list.map((task) => {
          if (task.folderId !== id) return task
          const { folderId, ...rest } = task
          return rest
        }),
      )
      await this.folderStore.mutate((list) =>
        list.filter((folder) => folder.id !== id),
      )
      await this.notifyTasksUpdate()
    })
  }

  public async moveTasks(ids: string[], folderId?: string): Promise<number> {
    return this.withFolders(async () => {
      if (
        folderId &&
        !(await this.getFolders()).some((folder) => folder.id === folderId)
      )
        throw new Error('文件夹不存在')
      const selected = new Set(ids)
      let count = 0
      const tasks = await this.store.mutate((list) => {
        // Validate the entire batch before writing so a stale selection cannot partially move.
        const existing = new Set(list.map((task) => task.id))
        if ([...selected].some((id) => !existing.has(id)))
          throw new Error('任务不存在')
        return list.map((task) => {
          if (!selected.has(task.id)) return task
          count++
          return { ...task, folderId: folderId || undefined }
        })
      })
      await this.notifyTasksUpdate(tasks)
      return count
    })
  }

  public async addCompletedTask(task: Task): Promise<void> {
    if (task.status !== 'completed') throw new Error('只能归档已完成的作品')
    const tasks = await withImageLifecycle(() => this.store.mutate((list) => [...list, task]))
    this.notifyTasksUpdate(tasks)
  }

  public async addVideoTask(task: Task): Promise<void> {
    if (!task.video || task.mediaType !== 'video') throw new Error('无效的视频任务')
    await withImageLifecycle(async () => {
      await assertInputImagesExist(task.rawTemplate.images)
      for (const url of task.rawTemplate.images) {
        const root = await fs.realpath(path.join(this.dataDir, 'images', 'input'))
        const file = path.join(root, url.split('/').pop()!)
        const resolved = await fs.realpath(file)
        if (path.dirname(resolved) !== root || (await fs.lstat(file)).isSymbolicLink()) throw new Error('参考图路径无效')
        const info = await fs.stat(file)
        if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('参考图不能超过 16 MiB')
        const bytes = await fs.readFile(file)
        const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        if (!png && !jpeg && !webp) throw new Error('视频参考图必须是 PNG、JPEG 或 WebP')
      }
      const tasks = await this.store.mutate((list) => {
        if (list.some((item) => item.id === task.id)) throw new Error('任务编号已存在')
        return [...list, task]
      })
      await this.notifyTasksUpdate(tasks)
    })
  }

  /** Atomic video updates prevent retrieval progress from overwriting generation state. */
  public async mutateVideoTask(id: string, mutate: (video: VideoTask) => void): Promise<void> {
    const tasks = await this.store.mutate((list) => list.map((task) => {
      if (task.id !== id || !task.video) return task
      mutate(task.video)
      const state = task.video.generationStatus
      return { ...task, status: state === 'succeeded' ? 'completed' as const :
        state === 'failed' || state === 'cancelled' ? 'failed' as const :
          state === 'queued' ? 'pending' as const : 'running' as const,
        error: task.video.error }
    }))
    await this.notifyTasksUpdate(tasks)
  }

  /** Append a validated backup without replacing existing tasks or folders. */
  public async restoreTasks(
    tasks: Task[],
    folders: TaskFolder[],
  ): Promise<void> {
    return withImageLifecycle(() => this.withFolders(async () => {
      const addedFolderIds = new Set(folders.map((folder) => folder.id))
      await this.folderStore.mutate((list) => {
        if (
          folders.some((folder) =>
            list.some(
              (item) =>
                item.id === folder.id ||
                item.name.toLocaleLowerCase() ===
                  folder.name.toLocaleLowerCase(),
            ),
          )
        )
          throw new Error('恢复文件夹编号冲突，请重试')
        const availableIds = new Set(
          [...list, ...folders].map((folder) => folder.id),
        )
        if (
          tasks.some(
            (task) => task.folderId && !availableIds.has(task.folderId),
          )
        )
          throw new Error('文件夹不存在')
        return [...list, ...folders]
      })
      try {
        const restored = await this.store.mutate((list) => {
          const ids = new Set(list.map((task) => task.id))
          if (tasks.some((task) => ids.has(task.id)))
            throw new Error('恢复任务编号冲突，请重试')
          return [...list, ...tasks]
        })
        await this.notifyTasksUpdate(restored)
      } catch (error) {
        await this.folderStore.mutate((list) =>
          list.filter((folder) => !addedFolderIds.has(folder.id)),
        )
        throw error
      }
    }))
  }

  public getBackupSnapshot(): Promise<{
    tasks: Task[]
    folders: TaskFolder[]
  }> {
    return this.withFolders(async () => ({
      tasks: await this.getTasks(),
      folders: await this.getFolders(),
    }))
  }

  public async createTaskFromTemplate(options: {
    template: TaskTemplate
    source: string
    size?: GptImageSize
    quality?: GptImageQuality
    endpointName?: string
    originalPrompt?: string
    folderId?: string
  }): Promise<Task> {
    return withImageLifecycle(() => this.withFolders(async () => {
      if (generationSignal()) await assertInputImagesExist(options.template.images)
      if (
        options.folderId &&
        !(await this.getFolders()).some(
          (folder) => folder.id === options.folderId,
        )
      )
        throw new Error('文件夹不存在')
      const newTask: Task = {
        id: uuidv4(),
        folderId: options.folderId || undefined,
        rawTemplate: options.template,
        source: options.source,
        size: options.size,
        quality: options.quality,
        endpointName: options.endpointName,
        ...(options.originalPrompt !== undefined
          ? { originalPrompt: options.originalPrompt }
          : {}),
        status: 'pending',
        createdAt: Date.now(),
      }

      const tasks = await this.store.mutate((list) => {
        list.push(newTask)
        return list
      })
      registerGenerationTask(newTask.id)
      this.notifyTasksUpdate(tasks)
      return newTask
    }))
  }

  public async deleteTask(id: string, keepImage = false): Promise<{ success: boolean; error?: string }> {
    try {
      const count = await this.deleteTasks([id], keepImage)
      return { success: count === 1 }
    } catch (error) { return { success: false, error: (error as Error).message } }
  }

  public async deleteTasks(ids: string[], keepImage = false): Promise<number> {
    const selected = new Set(ids)
    if (!selected.size) throw new Error('请先选择要删除的任务')
    const existing = new Set((await this.getTasks()).map((task) => task.id))
    if ([...selected].some((id) => !existing.has(id))) throw new Error('任务不存在')
    if ((await this.getTasks()).some((task) => selected.has(task.id) && task.video)) {
      const { videoManager } = await import('../../module/video/manager')
      await videoManager.beforeDelete([...selected], !keepImage)
    }
    // Do not hold the image lock while awaiting generators: they need it to finish.
    await Promise.all([...selected].map(cancelGenerationTask))
    return withImageLifecycle(async () => {
      let removed: Task[] = []
      const tasks = await this.store.mutate((list) => {
        // A concurrent delete may already have removed a validated task.
        removed = list.filter((task) => selected.has(task.id))
        return list.filter((task) => !selected.has(task.id))
      })
      await this.notifyTasksUpdate(tasks)
      if (!keepImage) {
        const urls = [...new Set(removed.flatMap((task) => task.outputUrls ?? (task.outputUrl ? [task.outputUrl] : [])))]
        if (urls.length) await deleteUnreferencedImagesUnlocked({ type: 'generated', urls })
      }
      return removed.length
    })
  }

  public async deleteTaskImage(
    id: string,
    imageIndex: number,
  ): Promise<{ success: boolean; error?: string }> {
    return withImageLifecycle(async () => {
    try {
      let outputUrl: string | undefined
      let error: string | undefined
      const tasks = await this.store.mutate((list) => {
        const task = list.find((item) => item.id === id)
        if (!task) {
          error = 'Task not found'
          return list
        }

        const outputUrls = task.outputUrls
          ? [...task.outputUrls]
          : task.outputUrl
            ? [task.outputUrl]
            : []
        if (
          !Number.isInteger(imageIndex) ||
          imageIndex < 0 ||
          imageIndex >= outputUrls.length
        ) {
          error = 'Task image not found'
          return list
        }
        if (outputUrls.length <= 1) {
          error = 'Cannot remove the only image from a task'
          return list
        }

        outputUrl = outputUrls[imageIndex]
        outputUrls.splice(imageIndex, 1)
        task.outputUrls = outputUrls
        if (task.outputUrl !== undefined) {
          task.outputUrl = outputUrls[0]
        }
        return list
      })

      if (error || !outputUrl) {
        return { success: false, error: error || 'Task image not found' }
      }

      this.notifyTasksUpdate(tasks)
      await this.deleteGeneratedImageFile(outputUrl)
      return { success: true }
    } catch (error: any) {
      this.logger.error('Failed to delete task image:', error)
      return {
        success: false,
        error: `Failed to delete task image: ${error.message}`,
      }
    }
    })
  }

  private async deleteGeneratedImageFile(outputUrl: string) {
    const prefix = `${GENERATED_IMAGES_API_PATH}/`
    if (!outputUrl.startsWith(prefix)) return

    try {
      const filename = decodeURIComponent(
        outputUrl.slice(prefix.length).split(/[?#]/)[0],
      )
      await deleteUnreferencedImagesUnlocked({ type: 'generated', urls: [`${GENERATED_IMAGES_API_PATH}/${filename}`] })
    } catch (error: any) {
      this.logger.error('Failed to delete task file:', error)
    }
  }

  public async updateTask(
    id: string,
    updates: Partial<Task>,
  ): Promise<boolean> {
    return withImageLifecycle(async () => {
      if (updates.outputUrls || updates.status === 'completed') checkGenerationCancelled()
    let found = false
    const tasks = await this.store.mutate((list) => {
      const index = list.findIndex((t) => t.id === id)
      if (index === -1) return list
      found = true
      list[index] = { ...list[index], ...updates }
      return list
    })

    if (found) {
      this.notifyTasksUpdate(tasks)
    }
    return found
    })
  }

  public async updateTaskStatus(
    id: string,
    status: Task['status'],
    error?: string,
  ): Promise<boolean> {
    let found = false
    const tasks = await this.store.mutate((list) => {
      const index = list.findIndex((t) => t.id === id)
      if (index === -1) return list
      found = true
      list[index].status = status
      if (error) {
        list[index].error = error
      }
      return list
    })

    if (found) {
      this.notifyTasksUpdate(tasks)
    }
    return found
  }
}

export const taskManager = new TaskManager()
