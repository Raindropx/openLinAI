import { EventEmitter } from 'events'
import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { StudioProvenance } from '../../../shared/studio'
import type { ImageBilling } from '../../module/gpt-image/billing'
import { GptImageQuality, GptImageSize } from '../../module/gpt-image/enum'
import { Logger } from '../../module/utils/logger'
import { getDataDir } from '../data-dir'
import { SafeJsonStore } from '../safe-json-store'
import { GENERATED_IMAGES_DIR } from '../static'
import { GENERATED_IMAGES_API_PATH } from '../static/enum'
import { TaskTemplate } from '../template-manager'

export interface Task {
  id: string
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
  /** 生成时使用的端点名快照（任务列表展示用） */
  endpointName?: string
  /** 采纳提示词优化结果前的本地文本，不参与生图请求 */
  originalPrompt?: string
  imageBilling?: ImageBilling
  studioItemId?: string
  studioProvenance?: StudioProvenance
  [key: string]: any
}

export class TaskManager extends EventEmitter {
  private dataDir: string
  private tasksDbPath: string
  private logger: Logger
  private store: SafeJsonStore<Task[]>

  constructor() {
    super()
    this.dataDir = getDataDir()
    this.tasksDbPath = path.join(this.dataDir, 'tasks.json')
    this.logger = new Logger('task-manager')
    this.store = new SafeJsonStore<Task[]>(this.tasksDbPath)
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
        if (task.status === 'pending' || task.status === 'running') {
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
      const list = tasks ?? (await this.getTasks())
      this.emit('tasks-updated', list)
    } catch (error) {
      this.logger.error('Failed to notify tasks update:', error)
    }
  }

  public async getTasks(): Promise<Task[]> {
    const tasks = await this.store.read()
    return tasks ?? []
  }

  public async addCompletedTask(task: Task): Promise<void> {
    if (task.status !== 'completed') throw new Error('只能归档已完成的作品')
    const tasks = await this.store.mutate((list) => [...list, task])
    this.notifyTasksUpdate(tasks)
  }

  public async createTaskFromTemplate(options: {
    template: TaskTemplate
    source: string
    size?: GptImageSize
    quality?: GptImageQuality
    endpointName?: string
    originalPrompt?: string
  }): Promise<Task> {
    const newTask: Task = {
      id: uuidv4(),
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
    this.notifyTasksUpdate(tasks)
    return newTask
  }

  public async deleteTask(
    id: string,
    keepImage?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      let target: Task | undefined
      const tasks = await this.store.mutate((list) => {
        target = list.find((t) => t.id === id)
        if (!target) return list
        return list.filter((t) => t.id !== id)
      })

      if (!target) {
        return { success: false, error: 'Task not found' }
      }

      this.notifyTasksUpdate(tasks)

      if (!keepImage) {
        const urlsToDelete = target.outputUrls
          ? target.outputUrls
          : target.outputUrl
            ? [target.outputUrl]
            : []

        for (const outputUrl of urlsToDelete) {
          await this.deleteGeneratedImageFile(outputUrl)
        }
      }
      return { success: true }
    } catch (error: any) {
      this.logger.error('Failed to delete task:', error)
      return {
        success: false,
        error: `Failed to delete task: ${error.message}`,
      }
    }
  }

  public async deleteTaskImage(
    id: string,
    imageIndex: number,
  ): Promise<{ success: boolean; error?: string }> {
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
  }

  private async deleteGeneratedImageFile(outputUrl: string) {
    const prefix = `${GENERATED_IMAGES_API_PATH}/`
    if (!outputUrl.startsWith(prefix)) return

    try {
      const relativePath = outputUrl.slice(prefix.length)
      const rootPath = path.resolve(GENERATED_IMAGES_DIR)
      const filepath = path.resolve(rootPath, relativePath)
      if (!filepath.startsWith(`${rootPath}${path.sep}`)) {
        this.logger.error('Refused to delete image outside generated directory')
        return
      }
      if (await fs.pathExists(filepath)) {
        await fs.unlink(filepath)
      }
    } catch (error: any) {
      this.logger.error('Failed to delete task file:', error)
    }
  }

  public async updateTask(
    id: string,
    updates: Partial<Task>,
  ): Promise<boolean> {
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
