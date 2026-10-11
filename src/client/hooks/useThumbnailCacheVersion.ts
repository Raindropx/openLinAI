import { useSyncExternalStore } from 'react'

const KEY = 'thumbnail-cache-version'
const EVENT = 'thumbnail-cache-rebuilt'
let fallback = ''
const snapshot = () => {
  try {
    return localStorage.getItem(KEY) || fallback
  } catch {
    return fallback
  }
}
const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify)
  window.addEventListener('storage', notify)
  return () => {
    window.removeEventListener(EVENT, notify)
    window.removeEventListener('storage', notify)
  }
}

export const useThumbnailCacheVersion = () =>
  useSyncExternalStore(subscribe, snapshot, () => '')

export function refreshThumbnailCache(version: string) {
  if (snapshot() === version) return
  fallback = version
  try {
    localStorage.setItem(KEY, version)
  } catch {
    /* Storage may be disabled. */
  }
  window.dispatchEvent(new Event(EVENT))
}
