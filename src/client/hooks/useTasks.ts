import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { Task } from '../../server/common/task-manager'
import type { TaskFolder } from '../../shared/task-folders'
import { createResourceCache, resourceData } from '../service/resources'
import { useGlobalStore } from '../store/global'

type Catalog = { tasks: Task[]; folders: TaskFolder[]; revision: string }
const catalog = createResourceCache('tasks', { tasks: [], folders: [], revision: '' } as Catalog, () => resourceData<Catalog>('/api/task/catalog'))
export function useTasks() {
  const state = catalog.useCache()
  const { tasks, folders, revision } = state.data
  useEffect(() => {
    if (!state.loaded) return
    const global = useGlobalStore.getState()
    if (global.taskFolderId && !folders.some((folder) => folder.id === global.taskFolderId)) global.setTaskFolderId('')
    if (global.generationFolderId && !folders.some((folder) => folder.id === global.generationFolderId)) global.setGenerationFolderId('')
  }, [folders, state.loaded])
  return { ...state, data: tasks, folders, revision }
}

type Detail = { task: Task & { outputUrls: string[] }; revision: string }
const useDetails = create<{ entries: Map<string, Detail>; error: Error | null }>(() => ({ entries: new Map(), error: null }))
const pending = new Map<string, Promise<Task | undefined>>()
const MAX_DETAILS = 160
async function ensureDetails(ids: string[], revision: string) {
  const entries = useDetails.getState().entries
  const missing = [...new Set(ids)].filter((id) => entries.get(id)?.revision !== revision && !pending.has(`${revision}:${id}`))
  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100)
    const request = resourceData<{ items: Task[]; revision: string }>('/api/task/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: batch, page: 0, pageSize: 100 }) })
      .then((result) => {
        if (catalog.getState().data.revision !== revision || result.revision !== revision) { catalog.refresh(); return [] }
        useDetails.setState((state) => {
          const next = new Map(state.entries)
          for (const task of result.items) { next.delete(task.id); next.set(task.id, { task: { ...task, outputUrls: task.outputUrls ?? (task.outputUrl ? [task.outputUrl] : []) }, revision }) }
          while (next.size > MAX_DETAILS) next.delete(next.keys().next().value!)
          return { entries: next, error: null }
        })
        return result.items
      }).catch((error) => { useDetails.setState({ error }); throw error })
    for (const id of batch) {
      const key = `${revision}:${id}`
      pending.set(key, request.then((items) => items.find((task) => task.id === id)).finally(() => pending.delete(key)))
    }
  }
  await Promise.all(ids.map((id) => pending.get(`${revision}:${id}`)))
}
export function useTaskDetails(ids: string[], revision: string) {
  const state = useDetails()
  const [attempt, setAttempt] = useState(0)
  const key = [...new Set(ids)].join(',')
  useEffect(() => { if (key && revision) void ensureDetails(key.split(','), revision).catch(() => {}) }, [key, revision, attempt])
  return { data: new Map(ids.flatMap((id) => {
    const entry = state.entries.get(id)
    return entry ? [[id, entry.task] as const] : []
  })), error: state.error, retry: () => setAttempt((value) => value + 1) }
}
export async function loadTask(id: string): Promise<Task> {
  await catalog.refreshAsync()
  const revision = catalog.getState().data.revision
  await ensureDetails([id], revision)
  const entry = useDetails.getState().entries.get(id)
  if (!entry || entry.revision !== revision) throw new Error('任务不存在或已更新，请重试')
  return entry.task
}
