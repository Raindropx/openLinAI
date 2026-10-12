import { randomUUID } from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import { getDataDir } from './data-dir'
import type { Task } from './task-manager'
import { taskManager } from './task-manager'
import { resourceRevision } from './resource-events'
import { taskListActions } from '../../shared/task-list'

const epoch = randomUUID()
let cached: { revision: string; tasks: Task[]; byId: Map<string, Task>; folders: Awaited<ReturnType<typeof taskManager.getFolders>> } | undefined
let reading: Promise<NonNullable<typeof cached>> | undefined
export async function taskSnapshot(): Promise<NonNullable<typeof cached>> {
  const stamps = await Promise.all(['tasks.json', 'task-folders.json'].map(async (name) => {
    try { const stat = await fs.stat(path.join(getDataDir(), name)); return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}` }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error }
  }))
  const eventRevision = resourceRevision('tasks')
  const revision = `${epoch}:${eventRevision}:${stamps.join(':')}`
  if (cached?.revision === revision) return cached
  if (reading) { await reading; return taskSnapshot() }
  const promise = (async () => {
    const [records, folders] = await Promise.all([taskManager.getTasks(true), taskManager.getFolders()])
    const tasks = [...records].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    const snapshot = { revision, tasks, folders, byId: new Map(tasks.map((task) => [task.id, task])) }
    if (resourceRevision('tasks') === eventRevision) cached = snapshot
    return snapshot
  })()
  reading = promise
  try { await promise } finally { if (reading === promise) reading = undefined }
  return taskSnapshot()
}

/** The catalog drives global selection/download/review without sending historical image snapshots. */
export function summarizeTask(task: Task): Task {
  return {
    id: task.id, folderId: task.folderId, source: task.source,
    status: task.status, createdAt: task.createdAt,
    outputUrl: task.outputUrl, outputUrls: task.outputUrls,
    size: task.size, quality: task.quality, endpointName: task.endpointName,
    error: task.error, duration: task.duration, providerQuality: task.providerQuality,
    imageBilling: task.imageBilling, gptTokenUsage: task.gptTokenUsage, usage: task.usage,
    studioProvenance: task.studioProvenance ? {
      origin: task.studioProvenance.origin, photopea: task.studioProvenance.photopea,
      inpaintRaw: task.studioProvenance.inpaintRaw,
    } : undefined,
    listActions: taskListActions(task),
    originalPrompt: task.originalPrompt,
    rawTemplate: {
      id: task.rawTemplate?.id ?? '', title: task.rawTemplate?.title,
      prompt: task.rawTemplate?.prompt ?? '', images: [],
      folder: task.rawTemplate?.folder, usageType: task.rawTemplate?.usageType ?? 'image',
      aspectRatio: task.rawTemplate?.aspectRatio,
      createdAt: task.rawTemplate?.createdAt ?? task.createdAt,
    },
    summaryOnly: true,
  }
}

export async function getTaskPage(options: { page: number; pageSize: number; ids?: string[]; folderId?: string; search?: string; sort?: string }) {
  const snapshot = await taskSnapshot()
  let tasks = options.ids
    ? options.ids.flatMap((id) => { const task = snapshot.byId.get(id); return task ? [task] : [] })
    : snapshot.tasks.filter((task) => options.folderId === undefined || (options.folderId ? task.folderId === options.folderId : !snapshot.folders.some((folder) => folder.id === task.folderId)))
  const keyword = options.search?.trim().toLocaleLowerCase('zh-CN')
  if (keyword) tasks = tasks.filter((task) => [task.rawTemplate?.title, task.rawTemplate?.prompt, task.originalPrompt, task.rawTemplate?.folder, task.endpointName, task.status, snapshot.folders.find((folder) => folder.id === task.folderId)?.name].some((value) => String(value ?? '').toLocaleLowerCase('zh-CN').includes(keyword)))
  if (options.sort && options.sort !== 'default') {
    tasks = [...tasks].sort((a, b) => {
      const title = () => (a.rawTemplate?.title || a.rawTemplate?.prompt || '').localeCompare(b.rawTemplate?.title || b.rawTemplate?.prompt || '', 'zh-CN', { numeric: true, sensitivity: 'base' })
      return options.sort === 'time-asc' ? a.createdAt - b.createdAt : options.sort === 'title-asc' ? title() : options.sort === 'title-desc' ? -title() : b.createdAt - a.createdAt
    })
  }
  const page = Math.min(options.page, Math.max(0, Math.ceil(tasks.length / options.pageSize) - 1))
  return { items: tasks.slice(page * options.pageSize, (page + 1) * options.pageSize), total: tasks.length, page, pageSize: options.pageSize, revision: snapshot.revision }
}
