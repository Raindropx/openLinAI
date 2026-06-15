export type MediaDecisionStatus = 'pending' | 'keep' | 'delete'
export type MediaImageStage = 'original' | 'screened' | 'classified' | 'trash'

export interface MediaWorkspaceSnapshot {
  sourceDir: string
  resultDir: string
  summary: {
    originalCount: number
    screenedCount: number
    trashCount: number
    classifiedCount: number
    pendingCount: number
  }
}

export interface MediaImageItem {
  relativePath: string
  name: string
  sourcePath: string
  resultPath: string | null
  size: number
  mtimeMs: number
  status: MediaDecisionStatus
  updatedAt: number | null
  previewUrl: string
  thumbUrl: string
}

export interface MediaImageListResult {
  items: MediaImageItem[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}
