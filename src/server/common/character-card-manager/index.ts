import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDataDir } from '../data-dir'
import { SafeJsonStore } from '../safe-json-store'
import { IMAGE_UPLOAD_MAX_BYTES } from '../static'

export type CharacterCardFormat = 'json' | 'png'

interface CharacterCardRecord {
  id: string
  name: string
  format: CharacterCardFormat
  card: Record<string, unknown>
  createdAt: number
  updatedAt: number
  /** 新记录使用不可变文件名；旧记录缺失时回退到 <id>.png。 */
  imageFile?: string
}

export interface StoredCharacterCard
  extends Omit<CharacterCardRecord, 'imageFile'> {
  imageUrl?: string
}

export interface CharacterCardInput {
  name: string
  format: CharacterCardFormat
  card: Record<string, unknown>
  pngData?: string
}

class CharacterCardManager {
  private cardsDir: string
  private store: SafeJsonStore<CharacterCardRecord[]>
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor() {
    const dataDir = getDataDir()
    this.cardsDir = path.join(dataDir, 'character-cards')
    fs.ensureDirSync(this.cardsDir)
    this.store = new SafeJsonStore(path.join(dataDir, 'character-cards.json'))
  }

  private toPublic(item: CharacterCardRecord): StoredCharacterCard {
    const { imageFile: _imageFile, ...publicItem } = item
    return {
      ...publicItem,
      ...(item.format === 'png'
        ? {
            imageUrl: `/api/character-card/${item.id}/image?v=${item.updatedAt}`,
          }
        : {}),
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private getImageFile(item: CharacterCardRecord) {
    return item.imageFile || `${item.id}.png`
  }

  private getImagePath(fileName: string) {
    return path.join(this.cardsDir, path.basename(fileName))
  }

  private async writePng(id: string, pngData: string): Promise<string> {
    const match = pngData.match(/^data:image\/png;base64,(.+)$/)
    if (!match) throw new Error('角色卡图片必须为 PNG')

    const buffer = Buffer.from(match[1], 'base64')
    if (buffer.length > IMAGE_UPLOAD_MAX_BYTES) {
      throw new Error('角色卡 PNG 不能超过 16 MiB')
    }
    if (
      buffer.length < 8 ||
      !buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      throw new Error('角色卡图片不是有效的 PNG')
    }

    const imageFile = `${id}.${uuidv4()}.png`
    const target = this.getImagePath(imageFile)
    const temporary = `${target}.${uuidv4()}.tmp`
    try {
      await fs.writeFile(temporary, buffer)
      await fs.rename(temporary, target)
      return imageFile
    } finally {
      await fs.remove(temporary).catch(() => undefined)
    }
  }

  async getAll() {
    const cards = (await this.store.read()) ?? []
    return cards
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => this.toPublic(item))
  }

  async create(input: CharacterCardInput) {
    return this.enqueueMutation(async () => {
      const now = Date.now()
      const record: CharacterCardRecord = {
        id: uuidv4(),
        name: input.name.trim() || '未命名角色',
        format: input.format,
        card: input.card,
        createdAt: now,
        updatedAt: now,
      }

      if (record.format === 'png') {
        if (!input.pngData) throw new Error('保存 PNG 角色卡需要角色图片')
        record.imageFile = await this.writePng(record.id, input.pngData)
      }

      try {
        await this.store.mutate((items) => [...items, record])
      } catch (error) {
        if (record.imageFile) {
          await fs
            .remove(this.getImagePath(record.imageFile))
            .catch(() => undefined)
        }
        throw error
      }
      return this.toPublic(record)
    })
  }

  async update(id: string, input: CharacterCardInput) {
    return this.enqueueMutation(async () => {
      const items = (await this.store.read()) ?? []
      const existing = items.find((item) => item.id === id)
      if (!existing) return null

      let newImageFile: string | undefined
      if (input.format === 'png') {
        if (!input.pngData) throw new Error('保存 PNG 角色卡需要角色图片')
        newImageFile = await this.writePng(id, input.pngData)
      }

      let updated: CharacterCardRecord | null = null
      try {
        await this.store.mutate((cards) =>
          cards.map((item) => {
            if (item.id !== id) return item
            updated = {
              ...item,
              name: input.name.trim() || '未命名角色',
              format: input.format,
              card: input.card,
              updatedAt: Date.now(),
              imageFile: newImageFile,
            }
            return updated
          }),
        )
      } catch (error) {
        if (newImageFile) {
          await fs
            .remove(this.getImagePath(newImageFile))
            .catch(() => undefined)
        }
        throw error
      }

      if (!updated) {
        if (newImageFile) {
          await fs
            .remove(this.getImagePath(newImageFile))
            .catch(() => undefined)
        }
        return null
      }

      if (existing.format === 'png') {
        const oldImageFile = this.getImageFile(existing)
        if (oldImageFile !== newImageFile) {
          await fs
            .remove(this.getImagePath(oldImageFile))
            .catch(() => undefined)
        }
      }
      return this.toPublic(updated)
    })
  }

  async delete(id: string) {
    return this.enqueueMutation(async () => {
      let deleted: CharacterCardRecord | undefined
      await this.store.mutate((items) => {
        deleted = items.find((item) => item.id === id)
        return items.filter((item) => item.id !== id)
      })
      if (!deleted) return false
      if (deleted.format === 'png') {
        await fs
          .remove(this.getImagePath(this.getImageFile(deleted)))
          .catch(() => undefined)
      }
      return true
    })
  }

  async getImage(id: string) {
    const cards = (await this.store.read()) ?? []
    const card = cards.find((item) => item.id === id && item.format === 'png')
    if (!card) return null
    const imagePath = this.getImagePath(this.getImageFile(card))
    if (!(await fs.pathExists(imagePath))) return null
    return fs.readFile(imagePath)
  }
}

export const characterCardManager = new CharacterCardManager()
