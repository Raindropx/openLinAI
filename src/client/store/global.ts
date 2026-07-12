import { hc } from 'hono/client'
import { create } from 'zustand'
import type { AppType } from '../../server'
import type {
  GptImageEndpoint,
  LlmEndpoint,
  LlmPrompts,
} from '../../server/common/config'
import type { TaskTemplate } from '../../server/common/template-manager'

const client = hc<AppType>('/')

interface GlobalState {
  /** @deprecated 旧版单 key，保留兼容；多端点下用 endpoints 判断是否已配置 */
  gptImageApiKey: string | null
  endpoints: GptImageEndpoint[]
  llmEndpoints: LlmEndpoint[]
  llmPrompts: LlmPrompts
  ttsInworldApiKey: string | null
  localNetworkUrl: string | null
  fillTemplateData: Partial<TaskTemplate> | null
  setFillTemplateData: (data: Partial<TaskTemplate> | null) => void
  setGptImageApiKey: (key: string | null) => Promise<void>
  saveEndpoints: (endpoints: GptImageEndpoint[]) => Promise<void>
  saveLlmEndpoints: (endpoints: LlmEndpoint[]) => Promise<void>
  saveLlmPrompts: (prompts: LlmPrompts) => Promise<void>
  setTTSInworldApiKey: (key: string | null) => Promise<void>
  fetchConfig: () => Promise<void>
}

/** 把接口返回的 data 同步进 store 的公共逻辑 */
function syncFromConfigData(data: Record<string, unknown>) {
  return {
    gptImageApiKey: data.gptImageApiKey as string | null,
    endpoints: (data.endpoints as GptImageEndpoint[]) ?? [],
    llmEndpoints: (data.llmEndpoints as LlmEndpoint[]) ?? [],
    llmPrompts: (data.llmPrompts as LlmPrompts) ?? {
      optimizePrompt: '',
      styleOptimizePrompt: '',
      charCardPrompt: '',
    },
    ttsInworldApiKey: (data.ttsInworldApiKey as string | null) ?? null,
    localNetworkUrl: (data.localNetworkUrl as string | null) ?? null,
  }
}

export const useGlobalStore = create<GlobalState>()((set) => ({
  gptImageApiKey: null,
  endpoints: [],
  llmEndpoints: [],
  llmPrompts: { optimizePrompt: '', styleOptimizePrompt: '', charCardPrompt: '' },
  ttsInworldApiKey: null,
  localNetworkUrl: null,
  fillTemplateData: null,
  setFillTemplateData: (data) => set({ fillTemplateData: data }),
  setGptImageApiKey: async (key) => {
    try {
      const res = await client.api.config.$post({
        json: { gptImageApiKey: key },
      })
      const json = await res.json()
      if (json.success) {
        set(syncFromConfigData(json.data as any))
      }
    } catch (error) {
      console.error('Failed to update config', error)
    }
  },
  saveEndpoints: async (endpoints) => {
    try {
      const res = await client.api.config.$post({ json: { endpoints } })
      const json = await res.json()
      if (json.success) {
        set(syncFromConfigData(json.data as any))
      }
    } catch (error) {
      console.error('Failed to save endpoints', error)
    }
  },
  saveLlmEndpoints: async (llmEndpoints) => {
    try {
      const res = await client.api.config.$post({ json: { llmEndpoints } })
      const json = await res.json()
      if (json.success) {
        set(syncFromConfigData(json.data as any))
      }
    } catch (error) {
      console.error('Failed to save llm endpoints', error)
    }
  },
  saveLlmPrompts: async (llmPrompts) => {
    try {
      const res = await client.api.config.$post({ json: { llmPrompts } })
      const json = await res.json()
      if (json.success) {
        set(syncFromConfigData(json.data as any))
      }
    } catch (error) {
      console.error('Failed to save llm prompts', error)
    }
  },
  setTTSInworldApiKey: async (key) => {
    try {
      const res = await client.api.config.$post({
        json: { ttsInworldApiKey: key },
      })
      const json = await res.json()
      if (json.success) {
        set(syncFromConfigData(json.data as any))
      }
    } catch (error) {
      console.error('Failed to update config', error)
    }
  },
  fetchConfig: async () => {
    try {
      const res = await client.api.config.$get()
      const json = await res.json()
      if (json.success) {
        set(syncFromConfigData(json.data as any))
      }
    } catch (error) {
      console.error('Failed to fetch config', error)
    }
  },
}))
