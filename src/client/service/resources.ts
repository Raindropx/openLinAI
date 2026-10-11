import { useEffect } from 'react'
import { create } from 'zustand'

type Resource = 'tasks' | 'templates' | 'images' | 'pending-images' | 'studio'
const listeners = new Map<Resource, Set<() => void>>()
let source: EventSource | undefined
let timer: ReturnType<typeof setTimeout> | undefined
const refreshAll = () => listeners.forEach((set) => set.forEach((listener) => listener()))
export function subscribeResource(resource: Resource, listener: () => void) {
  let set = listeners.get(resource)
  if (!set) listeners.set(resource, set = new Set())
  set.add(listener)
  if (timer) { clearTimeout(timer); timer = undefined }
  if (!source) {
    source = new EventSource('/api/resources/events')
    source.onopen = refreshAll
    source.addEventListener('change', (event: MessageEvent) => {
      try {
        const changes = JSON.parse(event.data) as { resource: Resource }[]
        for (const { resource } of changes) listeners.get(resource)?.forEach((notify) => notify())
      } catch (error) { console.error('资源同步失败', error) }
    })
    document.addEventListener('visibilitychange', onVisible)
  }
  return () => {
    set?.delete(listener)
    if (!set?.size) listeners.delete(resource)
    if (!listeners.size) timer = setTimeout(() => {
      source?.close(); source = undefined
      document.removeEventListener('visibilitychange', onVisible)
    }, 100)
  }
}
function onVisible() { if (document.visibilityState === 'visible') refreshAll() }

/** Retain successful data; serialize refreshes and reject obsolete responses. */
export function createResourceCache<T>(resource: Resource, initialValue: T, load: () => Promise<T>) {
  const useStore = create<{ data: T; loading: boolean; loaded: boolean; error: Error | null; version: number }>(() => ({ data: initialValue, loading: true, loaded: false, error: null, version: 0 }))
  let subscribers = 0
  let epoch = 0
  let requested = 0
  let running: Promise<void> | undefined
  let unsubscribe: (() => void) | undefined
  const refreshAsync = () => {
    requested++
    if (!running) {
      running = (async () => {
        let handled = 0
        while (handled !== requested) {
          handled = requested
          const round = epoch
          useStore.setState({ loading: !useStore.getState().loaded })
          try {
            const data = await load()
            if (round === epoch && handled === requested) useStore.setState((state) => ({ data, loading: false, loaded: true, error: null, version: state.version + 1 }))
          } catch (reason) {
            const error = reason instanceof Error ? reason : new Error(String(reason))
            if (round === epoch && handled === requested) useStore.setState({ loading: false, error })
            if (handled === requested) throw error
          }
        }
      })().finally(() => { running = undefined })
    }
    return running
  }
  const refresh = () => { void refreshAsync().catch(() => {}) }
  const subscribe = () => {
    if (subscribers++ === 0) { epoch++; unsubscribe = subscribeResource(resource, refresh); refresh() }
    return () => { if (--subscribers === 0) { epoch++; unsubscribe?.(); unsubscribe = undefined } }
  }
  const useCache = (enabled = true) => {
    const state = useStore()
    useEffect(() => enabled ? subscribe() : undefined, [enabled])
    return { ...state, refresh, refreshAsync }
  }
  return { useCache, refresh, refreshAsync, getState: useStore.getState }
}

export async function resourceData<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`)
  return result.data as T
}
