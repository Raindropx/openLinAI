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
}

export interface StoredCharacterCard extends CharacterCardRecord {
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

  constructor() {
    const dataDir = getDataDir()
    this.cardsDir = path.join(dataDir, 'character-cards')
    fs.ensureDirSync(this.cardsDir)
    this.store = new SafeJsonStore(path.join(dataDir, 'character-cards.json'))
  }

  private toPublic(item: CharacterCardRecord): StoredCharacterCard {
    return {
      ...item,
      ...(item.format === 'png'
        ? {
            imageUrl: `/api/character-card/${item.id}/image?v=${item.updatedAt}`,
          }
        : {}),
    }
  }

  private getImagePath(id: string) {
    return path.join(this.cardsDir, `${id}.png`)
  }

  private async writePng(id: string, pngData: string) {
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

    const target = this.getImagePath(id)
    const temporary = `${target}.tmp`
    await fs.writeFile(temporary, buffer)
    await fs.rename(temporary, target)
  }

  async getAll() {
    const cards = (await this.store.read()) ?? []
    return cards
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => this.toPublic(item))
  }

  async create(input: CharacterCardInput) {
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
      await this.writePng(record.id, input.pngData)
    }

    try {
      await this.store.mutate((items) => [...items, record])
    } catch (error) {
      if (record.format === 'png') {
        await fs.remove(this.getImagePath(record.id)).catch(() => undefined)
      }
      throw error
    }
    return this.toPublic(record)
  }

  async update(id: string, input: CharacterCardInput) {
    const items = (await this.store.read()) ?? []
    const existing = items.find((item) => item.id === id)
    if (!existing) return null

    if (input.format === 'png') {
      if (!input.pngData) throw new Error('保存 PNG 角色卡需要角色图片')
      await this.writePng(id, input.pngData)
    }

    let updated: CharacterCardRecord | null = null
    await this.store.mutate((cards) =>
      cards.map((item) => {
        if (item.id !== id) return item
        updated = {
          ...item,
          name: input.name.trim() || '未命名角色',
          format: input.format,
          card: input.card,
          updatedAt: Date.now(),
        }
        return updated
      }),
    )

    if (existing.format === 'png' && input.format === 'json') {
      await fs.remove(this.getImagePath(id)).catch(() => undefined)
    }
    return updated ? this.toPublic(updated) : null
  }

  async delete(id: string) {
    let deleted: CharacterCardRecord | undefined
    await this.store.mutate((items) => {
      deleted = items.find((item) => item.id === id)
      return items.filter((item) => item.id !== id)
    })
    if (!deleted) return false
    if (deleted.format === 'png') {
      await fs.remove(this.getImagePath(id)).catch(() => undefined)
    }
    return true
  }

  async getImage(id: string) {
    const cards = (await this.store.read()) ?? []
    const card = cards.find((item) => item.id === id && item.format === 'png')
    if (!card) return null
    const imagePath = this.getImagePath(id)
    if (!(await fs.pathExists(imagePath))) return null
    return fs.readFile(imagePath)
  }
}

export const characterCardManager = new CharacterCardManager()
