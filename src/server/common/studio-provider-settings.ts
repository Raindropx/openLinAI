import fs from 'fs-extra'
import path from 'path'
import type { StudioProviderSettings } from '../../shared/studio-generation'
import { getDataDir } from './data-dir'
import { SafeJsonStore } from './safe-json-store'

interface StoredProviderSettings {
  novelai: { apiKey: string; model: string }
  civitai: { apiKey: string }
}

const DEFAULT_SETTINGS: StoredProviderSettings = {
  novelai: { apiKey: '', model: 'nai-diffusion-5-full' },
  civitai: { apiKey: '' },
}

function keyHint(apiKey: string) {
  if (!apiKey) return undefined
  return apiKey.length <= 4 ? '••••' : `••••${apiKey.slice(-4)}`
}

class StudioProviderSettingsManager {
  private root = path.join(getDataDir(), 'studio')
  private store = new SafeJsonStore<StoredProviderSettings>(
    path.join(this.root, 'providers.json'),
  )

  private async read(): Promise<StoredProviderSettings> {
    await fs.ensureDir(this.root)
    const saved = await this.store.read()
    return {
      novelai: {
        ...DEFAULT_SETTINGS.novelai,
        ...(saved?.novelai || {}),
      },
      civitai: {
        ...DEFAULT_SETTINGS.civitai,
        ...(saved?.civitai || {}),
      },
    }
  }

  async publicSettings(): Promise<StudioProviderSettings> {
    const settings = await this.read()
    return {
      novelai: {
        configured: Boolean(settings.novelai.apiKey),
        keyHint: keyHint(settings.novelai.apiKey),
        model: settings.novelai.model,
      },
      civitai: {
        configured: Boolean(settings.civitai.apiKey),
        keyHint: keyHint(settings.civitai.apiKey),
      },
    }
  }

  async updateNovelAI(input: {
    apiKey?: string
    clearApiKey?: boolean
    model?: string
  }) {
    const current = await this.read()
    const next: StoredProviderSettings = {
      ...current,
      novelai: {
        apiKey: input.clearApiKey
          ? ''
          : input.apiKey?.trim() || current.novelai.apiKey,
        model: input.model?.trim() || current.novelai.model,
      },
    }
    await this.store.write(next)
    return this.publicSettings()
  }

  async updateCivitai(input: { apiKey?: string; clearApiKey?: boolean }) {
    const current = await this.read()
    const next: StoredProviderSettings = {
      ...current,
      civitai: {
        apiKey: input.clearApiKey
          ? ''
          : input.apiKey?.trim() || current.civitai.apiKey,
      },
    }
    await this.store.write(next)
    return this.publicSettings()
  }

  async novelai() {
    const value = (await this.read()).novelai
    if (!value.apiKey) throw new Error('请先设置 NovelAI API Token')
    return value
  }

  async civitai() {
    const value = (await this.read()).civitai
    if (!value.apiKey) throw new Error('请先设置 Civitai API Key')
    return value
  }
}

export const studioProviderSettings = new StudioProviderSettingsManager()
