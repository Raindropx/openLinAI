import { AsyncLocalStorage } from 'async_hooks'
import fs from 'fs-extra'
import path from 'path'
import { randomUUID } from 'crypto'
import { getDataDir } from './data-dir'
import { publishResource } from './resource-events'

let queue: Promise<unknown> = Promise.resolve()
/** Only short file/reference operations take this lock; network waits never do. */
export function withImageLifecycle<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action, action)
  queue = result.catch(() => {})
  return result
}

type Generation = {
  controller: AbortController
  done: Promise<void>
  finish: () => void
  tasks: Set<string>
  files: Map<string, boolean>
}
const context = new AsyncLocalStorage<Generation>()
const runs = new Map<string, Generation>()
export const activeGeneratedFiles = new Map<string, number>()
const createdGeneratedFiles = new Set<string>()
export const generationSignal = () => context.getStore()?.controller.signal
export function generationFetch(url: string | URL, options: RequestInit = {}) {
  const signals = [options.signal, generationSignal()].filter((signal): signal is AbortSignal => Boolean(signal))
  return fetch(url, { ...options, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) })
}
export const checkGenerationCancelled = () => generationSignal()?.throwIfAborted()
export function registerGenerationTask(id: string) {
  const run = context.getStore()
  if (run) { run.tasks.add(id); runs.set(id, run) }
}
export async function cancelGenerationTask(id: string) {
  const run = runs.get(id)
  if (run) { run.controller.abort(); await run.done }
}

/** Own all uncommitted output, including providers which return partial batches. */
export async function withImageGeneration<T>(action: () => Promise<T>): Promise<T> {
  if (context.getStore()) return action()
  let finish!: () => void
  const run: Generation = {
    controller: new AbortController(),
    done: new Promise<void>((resolve) => { finish = resolve }),
    finish: () => finish(), tasks: new Set(), files: new Map(),
  }
  return context.run(run, async () => {
    try { return await action() }
    finally {
      try {
        await withImageLifecycle(async () => {
          const created: string[] = []
          for (const filename of run.files.keys()) {
            const count = (activeGeneratedFiles.get(filename) ?? 1) - 1
            if (count) activeGeneratedFiles.set(filename, count)
            else {
              activeGeneratedFiles.delete(filename)
              if (createdGeneratedFiles.delete(filename)) created.push(filename)
            }
          }
          if (created.length) {
            const { deleteUnreferencedImagesUnlocked } = await import('./static')
            await deleteUnreferencedImagesUnlocked({ type: 'generated', urls: created.map((file) => `/api/static/images/generated/${file}`) })
          }
        })
      } catch (error) {
        console.error('生成输出收尾失败', error)
      } finally {
        for (const id of run.tasks) runs.delete(id)
        run.finish()
      }
    }
  })
}

export async function writeGenerationImage(filename: string, bytes: Buffer) {
  if (path.basename(filename) !== filename) throw new Error('Invalid image filename')
  await withImageLifecycle(async () => {
    checkGenerationCancelled()
    const run = context.getStore()
    const file = path.join(getDataDir(), 'images', 'generated', filename)
    let created = false
    if (!await fs.pathExists(file)) {
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx' })
        await fs.rename(temporary, file)
        created = true
      } finally { await fs.remove(temporary).catch(() => {}) }
    }
    if (run && created) createdGeneratedFiles.add(filename)
    if (run && !run.files.has(filename)) {
      run.files.set(filename, created)
      activeGeneratedFiles.set(filename, (activeGeneratedFiles.get(filename) ?? 0) + 1)
    }
    if (created) publishResource('images')
  })
}

export async function assertInputImagesExist(urls: string[]) {
  for (const url of urls) {
    const match = /^\/api\/static\/(?:images\/)?input\/([a-z0-9_-]+\.(?:png|jpe?g|webp|gif|avif|tiff?|svg))$/i.exec(url)
    if (!match || !await fs.pathExists(path.join(getDataDir(), 'images', 'input', match[1])))
      throw new Error('参考图文件不存在，请重新上传')
  }
}
