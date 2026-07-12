import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDataDir } from '../data-dir'
import { SafeJsonStore } from '../safe-json-store'

export interface CustomStylePreset {
  id: string
  name: string
  prompt: string
  origin: 'custom' | 'style-extract'
  createdAt: number
  updatedAt: number
}

class StylePresetManager {
  private store: SafeJsonStore<CustomStylePreset[]>

  constructor() {
    const dataDir = getDataDir()
    fs.ensureDirSync(dataDir)
    this.store = new SafeJsonStore(path.join(dataDir, 'style-presets.json'))
  }

  async getAll() {
    const items = (await this.store.read()) ?? []
    return items.map((item) => ({ ...item, origin: item.origin ?? 'custom' }))
  }

  async create(
    input: Pick<CustomStylePreset, 'name' | 'prompt'> & {
      origin?: CustomStylePreset['origin']
    },
  ) {
    const now = Date.now()
    const preset: CustomStylePreset = {
      name: input.name,
      prompt: input.prompt,
      origin: input.origin ?? 'custom',
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    }
    await this.store.mutate((items) => [...items, preset])
    return preset
  }

  async update(
    id: string,
    input: Pick<CustomStylePreset, 'name' | 'prompt'>,
  ): Promise<CustomStylePreset | null> {
    let updated: CustomStylePreset | null = null
    await this.store.mutate((items) =>
      items.map((item) => {
        if (item.id !== id) return item
        updated = { ...item, ...input, updatedAt: Date.now() }
        return updated
      }),
    )
    return updated
  }

  async delete(id: string) {
    let deleted = false
    await this.store.mutate((items) => {
      deleted = items.some((item) => item.id === id)
      return items.filter((item) => item.id !== id)
    })
    return deleted
  }
}

export const stylePresetManager = new StylePresetManager()
