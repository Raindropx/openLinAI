import { EventEmitter } from 'events'
import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDataDir } from '../data-dir'
import { SafeJsonStore } from '../safe-json-store'
import { GENERATED_IMAGES_DIR } from '../static'
import { GENERATED_IMAGES_API_PATH } from '../static/enum'
import { GptImageQuality, GptImageSize } from '../../module/gpt-image/enum'
import { Logger } from '../../module/utils/logger'
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
        if (task.status === 'pending' || task.status === 'running') {
          task.status = 'failed'
          task.error = '连接已丢失'
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

  public async getTasksByUsageType(
    usageType: TaskTemplate['usageType'],
  ): Promise<Task[]> {
    const tasks = await this.getTasks()
    return tasks.filter((t) => t.rawTemplate?.usageType === usageType)
  }

  public async createTaskFromTemplate(options: {
    template: TaskTemplate
    source: string
    size?: GptImageSize
    quality?: GptImageQuality
    endpointName?: string
  }): Promise<Task> {
    const newTask: Task = {
      id: uuidv4(),
      rawTemplate: options.template,
      source: options.source,
      size: options.size,
      quality: options.quality,
      endpointName: options.endpointName,
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
          if (outputUrl.startsWith('/api/static/')) {
            try {
              const filepath = path.join(
                GENERATED_IMAGES_DIR,
                outputUrl.replace(GENERATED_IMAGES_API_PATH + '/', ''),
              )

              if (filepath && fs.existsSync(filepath)) {
                await fs.unlink(filepath)
              }
            } catch (error: any) {
              this.logger.error('Failed to delete task file:', error)
            }
          }
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
