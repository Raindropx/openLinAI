export interface ThumbnailCacheStatus {
  id?: string
  state: 'idle' | 'running' | 'completed' | 'failed'
  phase: 'clearing' | 'rebuilding'
  total: number
  processed: number
  regenerated: number
  failed: number
  skipped: number
  removed: number
  error?: string
}
