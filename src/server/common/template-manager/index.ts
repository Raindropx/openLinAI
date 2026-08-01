import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDataDir } from '../data-dir'
import { SafeJsonStore } from '../safe-json-store'

export interface TaskTemplate {
  id: string
  title?: string
  /** 保存模板时选中的生图端点；旧模板可能没有此字段。 */
  endpointId?: string
  images: string[]
  prompt: string
  createdAt: number
  /** 模板用途；图片调用引擎由生成时选中的端点决定，chat-image 为兼容旧数据保留。 */
  usageType: 'image' | 'chat-image'
  aspectRatio?: string
  /** 勾选后会在提示词末尾追加“。画面比例X:Y”，用于不支持 size 参数的模型 */
  injectAspectRatio?: boolean
  folder?: string
  n?: number
  /** 用户拖动调整后的显示顺序；未设置的旧模板仍按创建时间倒序显示。 */
  sortOrder?: number
}

type RenameFolderResult =
  | { status: 'renamed'; updatedCount: number; newFolder: string }
  | { status: 'not-found' }
  | { status: 'conflict' }
  | { status: 'same-name' }

class TemplateManager {
  private dataDir: string
  private dbPath: string
  private store: SafeJsonStore<TaskTemplate[]>

  constructor() {
    this.dataDir = getDataDir()
    this.dbPath = path.join(this.dataDir, 'templates.json')
    this.store = new SafeJsonStore<TaskTemplate[]>(this.dbPath)
    this.init()
  }

  private init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }
    if (!fs.existsSync(this.dbPath)) {
      // 首次启动：同步写入示例模板，避免 async addTemplate 在构造函数中未 await
      const sample: TaskTemplate = {
        id: uuidv4(),
        title: '模板示例1',
        images: [],
        prompt: '生成一张2030年福瑞（furry）科目的中考试卷',
        usageType: 'image',
        aspectRatio: '16:9',
        createdAt: Date.now(),
      }
      fs.writeFileSync(this.dbPath, JSON.stringify([sample]), 'utf-8')
      return
    }

    // 校验现有文件是否可解析，损坏则备份并重建
    try {
      const data = fs.readFileSync(this.dbPath, 'utf-8')
      JSON.parse(data)
    } catch (error) {
      console.error('templates.json 解析失败，正在备份并重建:', error)
      this.store.backupCorruptFileSync()
      fs.writeFileSync(this.dbPath, JSON.stringify([]), 'utf-8')
    }
  }

  public async getTemplates(): Promise<TaskTemplate[]> {
    const templates = await this.store.read()
    return templates ?? []
  }

  public async addTemplate(
    template: Omit<TaskTemplate, 'id' | 'createdAt'>,
  ): Promise<TaskTemplate> {
    const newTemplate: TaskTemplate = {
      ...template,
      images: template.images || [],
      id: uuidv4(),
      createdAt: Date.now(),
    }
    await this.store.mutate((list) => {
      list.push(newTemplate)
      return list
    })
    return newTemplate
  }

  public async deleteTemplate(id: string): Promise<boolean> {
    let deleted = false
    await this.store.mutate((list) => {
      const target = list.find((t) => t.id === id)
      if (!target) return list
      deleted = true
      return list.filter((t) => t.id !== id)
    })
    return deleted
  }

  public async updateTemplate(
    id: string,
    updates: Partial<
      Pick<
        TaskTemplate,
        | 'title'
        | 'endpointId'
        | 'prompt'
        | 'aspectRatio'
        | 'injectAspectRatio'
        | 'folder'
        | 'images'
        | 'n'
      >
    >,
  ): Promise<TaskTemplate | null> {
    let result: TaskTemplate | null = null
    await this.store.mutate((list) => {
      const index = list.findIndex((t) => t.id === id)
      if (index === -1) return list
      list[index] = {
        ...list[index],
        ...(updates.folder !== undefined &&
        updates.folder !== list[index].folder
          ? { sortOrder: undefined }
          : {}),
        ...updates,
      }
      result = list[index]
      return list
    })
    return result
  }

  public async reorderTemplates(orderedIds: string[]): Promise<boolean> {
    let updated = false
    await this.store.mutate((list) => {
      const templatesById = new Map(list.map((template) => [template.id, template]))
      if (orderedIds.some((id) => !templatesById.has(id))) return list

      orderedIds.forEach((id, index) => {
        const template = templatesById.get(id)
        if (template) template.sortOrder = index
      })
      updated = true
      return list
    })
    return updated
  }

  public async renameFolder(
    oldFolder: string,
    newFolder: string,
  ): Promise<RenameFolderResult> {
    const normalizedNewFolder = newFolder.trim()
    let result: RenameFolderResult = { status: 'not-found' }
    await this.store.mutate((list) => {
      if (oldFolder === normalizedNewFolder) {
        result = { status: 'same-name' }
        return list
      }

      const sourceExists = list.some((template) => template.folder === oldFolder)
      if (!sourceExists) return list

      const targetExists = list.some(
        (template) => template.folder === normalizedNewFolder,
      )
      if (targetExists) {
        result = { status: 'conflict' }
        return list
      }

      let updatedCount = 0
      for (const t of list) {
        if (t.folder === oldFolder) {
          t.folder = normalizedNewFolder
          updatedCount++
        }
      }
      result = {
        status: 'renamed',
        updatedCount,
        newFolder: normalizedNewFolder,
      }
      return list
    })
    return result
  }
}

export const templateManager = new TemplateManager()
