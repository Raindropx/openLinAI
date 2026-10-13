import { hc } from 'hono/client'
import { useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import type { AppType } from '../../server'
import type { GPTImageQuotaResponse } from '../../server/api/gpt-image'
import { t } from '../i18n'
import { isAdmin } from '../pages/common/SettingModal'
import { useEnabledImageEndpoints } from './useEnabledImageEndpoints'
import { useLocalSetting } from './useLocalSetting'
import { useTasks } from './useTasks'

const client = hc<AppType>('/')

interface QuotaStore {
  data: GPTImageQuotaResponse['data'] | null
  error: string | null
  loading: boolean
  lastKey: string | null
  fetchPromise: Promise<void> | null
  requestId: number
  fetchQuota: (endpointId: string | null, force?: boolean) => Promise<void>
}

const useQuotaStore = create<QuotaStore>((set, get) => ({
  data: null,
  error: null,
  loading: false,
  lastKey: null,
  fetchPromise: null,
  requestId: 0,
  fetchQuota: async (endpointId, force = false) => {
    if (!endpointId) {
      set({
        data: null,
        error: null,
        lastKey: null,
        loading: false,
        fetchPromise: null,
        requestId: get().requestId + 1,
      })
      return
    }

    const state = get()
    if (
      !force &&
      state.lastKey === endpointId &&
      (state.data !== null || state.error !== null || state.loading)
    ) {
      return state.fetchPromise || Promise.resolve()
    }

    if (state.loading && state.lastKey === endpointId) {
      return state.fetchPromise || Promise.resolve()
    }

    const requestId = state.requestId + 1
    const promise = (async () => {
      set({ loading: true, error: null, data: null, lastKey: endpointId, requestId })
      try {
        const response = await client.api.gptImage.quota.$get({
          query: { endpointId },
        })
        const json = await response.json()
        if (!json.success) {
          throw new Error(t(json.error || '') || t('获取余额失败'))
        }
        if (get().requestId !== requestId) return
        set({
          data: json.data.data,
          error: null,
          loading: false,
          fetchPromise: null,
        })
      } catch (error: any) {
        if (get().requestId !== requestId) return
        console.error(error)
        set({ error: t(error.message), loading: false, fetchPromise: null })
      }
    })()

    set({ fetchPromise: promise })
    return promise
  },
}))

export const isPublicApiKey = (name?: string | null) =>
  name?.includes('公开') ||
  name?.includes('共用') ||
  name?.includes('公用') ||
  false

export function useGPTImageQuota() {
  const endpoints = useEnabledImageEndpoints()
  const { gptImageSettings } = useLocalSetting()
  const selectedEndpointId = gptImageSettings.selectedEndpointId
  const selectedEndpoint = useMemo(
    () => endpoints.find((e) => e.id === selectedEndpointId) || endpoints[0],
    [endpoints, selectedEndpointId],
  )
  // New API / OpenRouter / Venice 默认查余额；自定义端点按配置决定
  const activeEndpointId =
    selectedEndpoint?.type === 'yunwu' ||
    selectedEndpoint?.type === 'openrouter' ||
    selectedEndpoint?.type === 'venice' ||
    selectedEndpoint?.type === 'novelai' ||
    (selectedEndpoint?.type === 'custom' && selectedEndpoint.balanceEnabled) ||
    (selectedEndpoint?.type === 'laozhang' &&
      selectedEndpoint.balanceEnabled &&
      selectedEndpoint.balanceAccessTokenConfigured)
      ? selectedEndpoint.id
      : null
  const customBalanceConfig =
    selectedEndpoint?.type === 'custom' || selectedEndpoint?.type === 'laozhang'
      ? `${selectedEndpoint.balanceEnabled}:${selectedEndpoint.balanceApiPath}:${selectedEndpoint.balanceResultJsonKey}:${selectedEndpoint.balanceAccessTokenConfigured}:${selectedEndpoint.baseURL}`
      : null

  const { data: tasks } = useTasks()
  const knownCompletedTasks = useRef<Set<string> | null>(null)

  const data = useQuotaStore((state) => state.data)
  const lastKey = useQuotaStore((state) => state.lastKey)
  const loading = useQuotaStore((state) => state.loading)
  const error = useQuotaStore((state) => state.error)
  const fetchQuota = useQuotaStore((state) => state.fetchQuota)

  const isPublic = useMemo(
    () => isPublicApiKey(data?.name) && !isAdmin(),
    [data?.name],
  )

  useEffect(() => {
    fetchQuota(activeEndpointId, customBalanceConfig !== null)
  }, [activeEndpointId, customBalanceConfig, selectedEndpoint, fetchQuota])

  useEffect(() => {
    if (!tasks || !activeEndpointId) return

    // 假设第一页任务数量为前 20 条
    const recentTasks = tasks.slice(0, 20)

    if (knownCompletedTasks.current === null) {
      // 初始化已完成任务集合
      knownCompletedTasks.current = new Set()
      for (const task of recentTasks) {
        if (task.status === 'completed') {
          knownCompletedTasks.current.add(task.id)
        }
      }
      return
    }

    let hasNewCompletedTask = false
    for (const task of recentTasks) {
      if (task.status === 'completed') {
        if (!knownCompletedTasks.current.has(task.id)) {
          hasNewCompletedTask = true
          knownCompletedTasks.current.add(task.id)
        }
      }
    }

    if (hasNewCompletedTask) {
      fetchQuota(activeEndpointId, true)
    }
  }, [tasks, activeEndpointId, fetchQuota])

  return {
    quota: activeEndpointId && lastKey === activeEndpointId ? data : null,
    loading,
    error,
    isPublic,
    refresh: () => fetchQuota(activeEndpointId, true),
  }
}
