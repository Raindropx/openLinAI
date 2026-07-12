import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GptImageQuality } from '../../server/module/gpt-image/enum'

export interface GPTImageSettings {
  enable1K: boolean
  enable2K: boolean
  enable4K: boolean
  quality: GptImageQuality
  enableMultiple?: boolean
  keepImageWhenDeleteTask?: boolean
  /** 默认端点 id（设置里「设为默认」写入，持久化）。刷新后回退到此值。 */
  defaultEndpointId?: string
  /**
   * 当前选中的端点 id（生成时用）。
   * 注意：此项不持久化（见下方 partialize），刷新后会回退到 defaultEndpointId。
   * 这样表单里的下拉切换不会覆盖设置里指定的默认端点。
   */
  selectedEndpointId?: string
}

export const defaultGPTImageSettings: GPTImageSettings = {
  enable1K: true,
  enable2K: true,
  enable4K: false,
  quality: 'medium',
  enableMultiple: false,
  keepImageWhenDeleteTask: false,
}

export interface LocalSettingState {
  gptImageSettings: GPTImageSettings
  /** 提示词优化使用的 LLM 端点 id。持久化。 */
  optimizeEndpointId?: string
  /** 角色卡生成使用的 LLM 端点 id。持久化。 */
  charCardEndpointId?: string
  /** 图片风格提取使用的多模态 LLM 端点 id。持久化。 */
  styleExtractEndpointId?: string
  yunwuSystemToken?: string
  yunwuUserId?: string
  setGptImageSettings: (
    settings: GPTImageSettings | ((prev: GPTImageSettings) => GPTImageSettings),
  ) => void
  setOptimizeEndpointId: (id: string | undefined) => void
  setCharCardEndpointId: (id: string | undefined) => void
  setStyleExtractEndpointId: (id: string | undefined) => void
  setYunwuSystemToken: (token: string) => void
  setYunwuUserId: (userId: string) => void
}

const useLocalSettingStore = create<LocalSettingState>()(
  persist(
    (set) => ({
      gptImageSettings: defaultGPTImageSettings,
      optimizeEndpointId: undefined,
      charCardEndpointId: undefined,
      styleExtractEndpointId: undefined,
      yunwuSystemToken: undefined,
      yunwuUserId: undefined,
      setGptImageSettings: (settings) =>
        set((state) => ({
          gptImageSettings:
            typeof settings === 'function'
              ? settings(state.gptImageSettings)
              : settings,
        })),
      setOptimizeEndpointId: (id) => set({ optimizeEndpointId: id }),
      setCharCardEndpointId: (id) => set({ charCardEndpointId: id }),
      setStyleExtractEndpointId: (id) => set({ styleExtractEndpointId: id }),
      setYunwuSystemToken: (token) => set({ yunwuSystemToken: token }),
      setYunwuUserId: (userId) => set({ yunwuUserId: userId }),
    }),
    {
      name: 'gpt-image-settings',
      // gptImageSettings.selectedEndpointId 是会话内选择，不持久化；
      // 其余（defaultEndpointId 等）都持久化
      partialize: (state) => {
        const { gptImageSettings, ...rest } = state
        const { selectedEndpointId, ...persistedSettings } = gptImageSettings
        return { gptImageSettings: persistedSettings as GPTImageSettings, ...rest }
      },
      // 迁移：旧版字段名为 roleplayEndpointId，新版改为 charCardEndpointId
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Record<string, unknown> | undefined
        if (persisted && persisted.roleplayEndpointId && !persisted.charCardEndpointId) {
          persisted.charCardEndpointId = persisted.roleplayEndpointId
          delete persisted.roleplayEndpointId
        }
        return { ...currentState, ...persisted }
      },
    },
  ),
)

export function useLocalSetting() {
  const gptImageSettings = useLocalSettingStore(
    (state) => state.gptImageSettings,
  )
  const optimizeEndpointId = useLocalSettingStore(
    (state) => state.optimizeEndpointId,
  )
  const charCardEndpointId = useLocalSettingStore(
    (state) => state.charCardEndpointId,
  )
  const styleExtractEndpointId = useLocalSettingStore(
    (state) => state.styleExtractEndpointId,
  )
  const yunwuSystemToken = useLocalSettingStore(
    (state) => state.yunwuSystemToken,
  )
  const yunwuUserId = useLocalSettingStore((state) => state.yunwuUserId)
  const setGptImageSettings = useLocalSettingStore(
    (state) => state.setGptImageSettings,
  )
  const setOptimizeEndpointId = useLocalSettingStore(
    (state) => state.setOptimizeEndpointId,
  )
  const setCharCardEndpointId = useLocalSettingStore(
    (state) => state.setCharCardEndpointId,
  )
  const setStyleExtractEndpointId = useLocalSettingStore(
    (state) => state.setStyleExtractEndpointId,
  )
  const setYunwuSystemToken = useLocalSettingStore(
    (state) => state.setYunwuSystemToken,
  )
  const setYunwuUserId = useLocalSettingStore((state) => state.setYunwuUserId)

  // selectedEndpointId 不持久化，刷新后为空 → 回退到 defaultEndpointId
  const mergedSettings = useMemo(
    () => ({
      ...defaultGPTImageSettings,
      ...gptImageSettings,
      selectedEndpointId:
        gptImageSettings.selectedEndpointId ||
        gptImageSettings.defaultEndpointId,
    }),
    [gptImageSettings],
  )

  return {
    gptImageSettings: mergedSettings,
    optimizeEndpointId,
    charCardEndpointId,
    styleExtractEndpointId,
    yunwuSystemToken,
    yunwuUserId,
    setGptImageSettings,
    setOptimizeEndpointId,
    setCharCardEndpointId,
    setStyleExtractEndpointId,
    setYunwuSystemToken,
    setYunwuUserId,
  }
}
