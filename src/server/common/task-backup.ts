import fs from 'fs-extra'
import JSZip from 'jszip'
import crypto from 'node:crypto'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { v4 as uuidv4 } from 'uuid'
import { studioFileUrl, type StudioItem } from '../../shared/studio'
import {
  mapBackupImageUrls,
  TASK_BACKUP_MANIFEST,
  TASK_BACKUP_MAX_BYTES,
  TASK_BACKUP_MAX_EXPANDED_BYTES,
  TASK_BACKUP_MAX_FILE_BYTES,
  taskBackupSchema,
  type TaskBackup,
} from '../../shared/task-backup'
import type { TaskFolder } from '../../shared/task-folders'
import { sanitizeSvg } from '../module/gpt-image/image-files'
import {
  getConfig,
  saveRestoredImageEndpoints,
  type GptImageEndpoint,
} from './config'
import { GENERATED_IMAGES_DIR, INPUT_IMAGES_DIR } from './static'
import { GENERATED_IMAGES_API_PATH, INPUT_IMAGES_API_PATH } from './static/enum'
import { studioManager } from './studio-manager'
import { taskManager, type Task } from './task-manager'

const MANIFEST_MAX_BYTES = 16 * 1024 * 1024
const digest = (buffer: Buffer) =>
  crypto.createHash('sha256').update(buffer).digest('hex')
let queue: Promise<unknown> = Promise.resolve()

function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action)
  queue = result.catch(() => {})
  return result
}

function imageLocation(url: string) {
  for (const [prefix, directory] of [
    [GENERATED_IMAGES_API_PATH, GENERATED_IMAGES_DIR],
    [INPUT_IMAGES_API_PATH, INPUT_IMAGES_DIR],
  ]) {
    if (!url.startsWith(`${prefix}/`)) continue
    const filename = decodeURIComponent(url.slice(prefix.length + 1))
    if (
      !filename ||
      /[\\/:*?"<>|\u0000-\u001f]/.test(filename) ||
      filename === '.' ||
      filename === '..'
    )
      throw new Error('备份图片地址无效')
    return { directory, filename, prefix }
  }
  return undefined
}

function studioIdFromUrl(url: string) {
  return /^\/api\/studio\/items\/([\da-f-]{36})\/file$/i.exec(url)?.[1]
}

function walkRecords(
  value: unknown,
  visit: (record: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) walkRecords(item, visit)
  } else if (value && typeof value === 'object') {
    visit(value as Record<string, unknown>)
    for (const item of Object.values(value)) walkRecords(item, visit)
  }
}

function checkUnique(values: string[]) {
  if (new Set(values).size !== values.length)
    throw new Error('备份包含重复编号或图片地址')
}

function validateReferences(backup: TaskBackup) {
  checkUnique(backup.tasks.map((task) => task.id))
  checkUnique(backup.folders.map((folder) => folder.id))
  checkUnique(backup.folders.map((folder) => folder.name.toLocaleLowerCase()))
  checkUnique(backup.endpoints.map((endpoint) => endpoint.id))
  checkUnique(backup.studioItems.map((item) => item.id))
  checkUnique(backup.assets.map((asset) => asset.url))
  const taskIds = new Set(backup.tasks.map((task) => task.id))
  const folderIds = new Set(backup.folders.map((folder) => folder.id))
  const studioIds = new Set(backup.studioItems.map((item) => item.id))
  const assetUrls = new Set(backup.assets.map((asset) => asset.url))
  if (
    backup.tasks.some((task) => task.folderId && !folderIds.has(task.folderId))
  )
    throw new Error('备份缺少任务文件夹')
  if (backup.downloadedTaskIds.some((id) => !taskIds.has(id)))
    throw new Error('备份下载标记无效')
  mapBackupImageUrls([backup.tasks, backup.studioItems], (url) => {
    if (!url.startsWith('data:image/') && !assetUrls.has(url))
      throw new Error('备份缺少任务引用的图片')
    return url
  })
  for (const item of backup.studioItems) {
    if (!assetUrls.has(studioFileUrl(item.id)))
      throw new Error('备份缺少任务引用的素材')
  }
  walkRecords([backup.tasks, backup.studioItems], (record) => {
    if (
      typeof record.referenceItemId === 'string' &&
      !studioIds.has(record.referenceItemId)
    )
      throw new Error('备份缺少任务引用的素材')
  })
  for (const asset of backup.assets) {
    if (!imageLocation(asset.url) && !studioIdFromUrl(asset.url))
      throw new Error('备份图片地址无效')
  }
}

/** Full-list archive. No provider calls or image re-encoding take place. */
export function createTaskBackup(
  downloadedTaskIds: string[] = [],
): Promise<Buffer> {
  return exclusive(async () => {
    const { tasks, folders } = await taskManager.getBackupSnapshot()
    const backup: TaskBackup = {
      format: 'openlinai.task-list-backup',
      version: 1,
      createdAt: Date.now(),
      tasks: taskBackupSchema.shape.tasks.parse(tasks),
      folders,
      endpoints: JSON.parse(JSON.stringify(getConfig().endpoints)),
      downloadedTaskIds: downloadedTaskIds.filter((id) =>
        tasks.some((task) => task.id === id),
      ),
      assets: [],
      studioItems: [],
    }
    const urls = new Set<string>()
    const requiredStudioIds = new Set<string>()
    const collect = (value: unknown) => {
      mapBackupImageUrls(value, (url) => {
        if (url.startsWith('data:image/')) return url
        urls.add(url)
        const studioId = studioIdFromUrl(url)
        if (studioId) requiredStudioIds.add(studioId)
        return url
      })
      walkRecords(value, (record) => {
        if (typeof record.referenceItemId === 'string')
          requiredStudioIds.add(record.referenceItemId)
      })
    }
    collect(tasks)
    const studioItems = await studioManager.list()
    for (const task of tasks) {
      if (
        task.studioItemId &&
        studioItems.some((item) => item.id === task.studioItemId)
      )
        requiredStudioIds.add(task.studioItemId)
    }
    // Studio reference chains can point to earlier shelf items.
    for (const id of requiredStudioIds) {
      const item = studioItems.find((entry) => entry.id === id)
      if (!item) throw new Error('任务引用的素材已丢失，无法创建完整备份')
      backup.studioItems.push(
        taskBackupSchema.shape.studioItems.element.parse(item),
      )
      urls.add(studioFileUrl(id))
      collect(item)
    }

    const zip = new JSZip()
    const packedPaths = new Set<string>()
    let expandedBytes = 0
    for (const url of urls) {
      const location = imageLocation(url)
      let buffer: Buffer
      let extension: string
      if (location) {
        const root = await fs.realpath(location.directory)
        const file = await fs
          .realpath(path.join(location.directory, location.filename))
          .catch(() => {
            throw new Error('任务引用的图片已丢失，无法创建完整备份')
          })
        if (!file.startsWith(`${root}${path.sep}`))
          throw new Error('备份图片地址无效')
        const stat = await fs.stat(file)
        if (!stat.isFile() || stat.size > TASK_BACKUP_MAX_FILE_BYTES)
          throw new Error('备份单个图片不能超过 64 MiB')
        buffer = await fs.readFile(file)
        extension = path.extname(location.filename).slice(1).toLowerCase()
      } else {
        const id = studioIdFromUrl(url)
        if (!id) throw new Error('任务包含不支持的图片地址，无法创建完整备份')
        const file = await studioManager.file(id)
        buffer = file.buffer
        extension = file.item.format === 'jpeg' ? 'jpg' : file.item.format
      }
      if (
        !/^(png|jpg|jpeg|webp|gif|avif|tif|tiff|bmp|svg|psd)$/.test(extension)
      )
        throw new Error('任务包含不支持的图片格式')
      const sha256 = digest(buffer)
      const archivePath = `assets/${sha256}.${extension}`
      backup.assets.push({
        url,
        path: archivePath,
        bytes: buffer.length,
        sha256,
      })
      if (!packedPaths.has(archivePath)) {
        expandedBytes += buffer.length
        if (expandedBytes > TASK_BACKUP_MAX_EXPANDED_BYTES)
          throw new Error('备份解压后不能超过 1 GiB')
        packedPaths.add(archivePath)
        zip.file(archivePath, buffer)
      }
    }
    taskBackupSchema.parse(backup)
    validateReferences(backup)
    const manifest = JSON.stringify(backup, null, 2)
    if (Buffer.byteLength(manifest) > MANIFEST_MAX_BYTES)
      throw new Error('备份任务信息不能超过 16 MiB')
    zip.file(TASK_BACKUP_MANIFEST, manifest, { compression: 'DEFLATE' })
    const archive = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'STORE',
    })
    if (archive.length > TASK_BACKUP_MAX_BYTES)
      throw new Error('备份 ZIP 不能超过 512 MiB')
    return archive
  })
}

/** Bound inflation before accumulating bytes, including forged ZIP size headers. */
async function readZipFile(
  file: JSZip.JSZipObject,
  maxBytes: number,
): Promise<Buffer> {
  const stream = file.nodeStream('nodebuffer') as Readable
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    stream.on('data', (chunk: Buffer) => {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > maxBytes) {
        stream.destroy()
        reject(new Error('备份文件解压大小超出限制'))
        return
      }
      chunks.push(bytes)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks, size)))
  })
}

function remapRecords(
  value: unknown,
  maps: {
    task: Map<string, string>
    folder: Map<string, string>
    endpoint: Map<string, string>
    studio: Map<string, string>
  },
) {
  walkRecords(value, (record) => {
    for (const [key, map] of [
      ['endpointId', maps.endpoint],
      ['folderId', maps.folder],
      ['sourceTaskId', maps.task],
      ['archivedTaskId', maps.task],
      ['studioItemId', maps.studio],
      ['referenceItemId', maps.studio],
    ] as const) {
      const oldId = record[key]
      if (typeof oldId === 'string') {
        if (map.has(oldId)) record[key] = map.get(oldId)
        else if (key === 'studioItemId') delete record[key]
      }
    }
  })
}

function mergeEndpoints(endpoints: GptImageEndpoint[]) {
  const current = getConfig().endpoints
  const added: GptImageEndpoint[] = []
  const map = new Map<string, string>()
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, ordered(item)]),
    )
  }
  const signature = (endpoint: GptImageEndpoint) => {
    const { id, name, balanceAccessTokenConfigured, ...settings } = endpoint
    return JSON.stringify(ordered(settings))
  }
  for (const endpoint of endpoints) {
    const existing = [...current, ...added].find(
      (item) => signature(item) === signature(endpoint),
    )
    if (existing) {
      map.set(endpoint.id, existing.id)
      continue
    }
    const imported = { ...endpoint, id: uuidv4() }
    const names = new Set([...current, ...added].map((item) => item.name))
    let suffix = 2
    while (names.has(imported.name))
      imported.name = `${endpoint.name} (${suffix++})`
    map.set(endpoint.id, imported.id)
    added.push(imported)
  }
  if (added.length) saveRestoredImageEndpoints([...current, ...added])
  return { map, addedIds: new Set(added.map((endpoint) => endpoint.id)) }
}

export function restoreTaskBackup(archive: Buffer) {
  return exclusive(async () => {
    if (!archive.length || archive.length > TASK_BACKUP_MAX_BYTES)
      throw new Error('备份 ZIP 不能超过 512 MiB')
    let zip: JSZip
    let backup: TaskBackup
    try {
      zip = await JSZip.loadAsync(archive)
      const manifest = zip.file(TASK_BACKUP_MANIFEST)
      if (!manifest) throw new Error('missing manifest')
      backup = taskBackupSchema.parse(
        JSON.parse(
          (await readZipFile(manifest, MANIFEST_MAX_BYTES)).toString('utf8'),
        ),
      )
    } catch {
      throw new Error('备份 ZIP 无效或版本不受支持')
    }
    validateReferences(backup)
    const expectedPaths = new Set([
      TASK_BACKUP_MANIFEST,
      ...backup.assets.map((asset) => asset.path),
    ])
    if (Object.keys(zip.files).length > 30002)
      throw new Error('备份文件数量超出限制')
    for (const file of Object.values(zip.files)) {
      if (file.dir) {
        if (file.name !== 'assets/') throw new Error('备份文件路径无效')
      } else if (
        !expectedPaths.has(file.name) ||
        (file.unsafeOriginalName && file.unsafeOriginalName !== file.name)
      ) {
        throw new Error('备份文件路径无效')
      }
    }
    const buffers = new Map<string, Buffer>()
    let expandedBytes = 0
    for (const asset of backup.assets) {
      if (!buffers.has(asset.path)) {
        const file = zip.file(asset.path)
        if (!file) throw new Error('备份缺少图片文件')
        const buffer = await readZipFile(file, asset.bytes)
        expandedBytes += buffer.length
        if (expandedBytes > TASK_BACKUP_MAX_EXPANDED_BYTES)
          throw new Error('备份解压后不能超过 1 GiB')
        buffers.set(asset.path, buffer)
      }
      const buffer = buffers.get(asset.path)!
      if (buffer.length !== asset.bytes || digest(buffer) !== asset.sha256)
        throw new Error('备份图片校验失败')
      if (asset.path.endsWith('.svg') && !sanitizeSvg(buffer).equals(buffer))
        throw new Error('备份 SVG 包含不安全内容')
    }
    const maps = {
      task: new Map(backup.tasks.map((task) => [task.id, uuidv4()])),
      folder: new Map<string, string>(),
      endpoint: new Map<string, string>(),
      studio: new Map(backup.studioItems.map((item) => [item.id, uuidv4()])),
    }
    const folders: TaskFolder[] = []
    const currentFolders = await taskManager.getFolders()
    for (const folder of backup.folders) {
      const existing = currentFolders.find(
        (item) =>
          item.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase(),
      )
      const id = existing?.id || uuidv4()
      maps.folder.set(folder.id, id)
      if (!existing) folders.push({ ...folder, id })
    }
    const urls = new Map<string, string>()
    const files: Array<{ path: string; buffer: Buffer }> = []
    for (const asset of backup.assets) {
      const location = imageLocation(asset.url)
      if (location) {
        const filename = `restored-${uuidv4()}${path.extname(asset.path)}`
        urls.set(asset.url, `${location.prefix}/${filename}`)
        files.push({
          path: path.join(location.directory, filename),
          buffer: buffers.get(asset.path)!,
        })
      } else {
        const studioId = studioIdFromUrl(asset.url)!
        const restoredId = maps.studio.get(studioId)
        if (!restoredId) throw new Error('备份缺少素材信息')
        urls.set(asset.url, studioFileUrl(restoredId))
      }
    }
    const restoreImageUrl = (url: string) => urls.get(url) || url
    const tasks = mapBackupImageUrls(backup.tasks, restoreImageUrl) as Task[]
    const items = mapBackupImageUrls(
      backup.studioItems,
      restoreImageUrl,
    ) as StudioItem[]
    for (const task of tasks) {
      task.id = maps.task.get(task.id)!
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'failed'
        task.error = '[服务] 从备份恢复，原生成任务已中断'
      }
      if (task.imageBilling?.status === 'pending')
        task.imageBilling.status = 'unavailable'
    }
    const studioEntries = items.map((item) => {
      const asset = backup.assets.find(
        (asset) => asset.url === studioFileUrl(item.id),
      )!
      item.id = maps.studio.get(item.id)!
      return { item, buffer: buffers.get(asset.path)! }
    })
    const written: string[] = []
    let studioWritten = false
    let addedEndpointIds = new Set<string>()
    try {
      // All ZIP/schema/path/hash/reference validation has finished before writing.
      for (const file of files) {
        await fs.writeFile(file.path, file.buffer, { flag: 'wx' })
        written.push(file.path)
      }
      const endpoints = mergeEndpoints(backup.endpoints as GptImageEndpoint[])
      maps.endpoint = endpoints.map
      addedEndpointIds = endpoints.addedIds
      remapRecords([tasks, items], maps)
      if (studioEntries.length) {
        await studioManager.restoreBackupItems(studioEntries)
        studioWritten = true
      }
      await taskManager.restoreTasks(tasks, folders)
    } catch (error) {
      // Remove only this attempt's additions; never replace pre-existing state.
      const rollbackErrors: unknown[] = []
      if (studioWritten) {
        await studioManager
          .removeBackupItems(new Set(maps.studio.values()))
          .catch((failure) => rollbackErrors.push(failure))
      }
      if (addedEndpointIds.size) {
        try {
          saveRestoredImageEndpoints(
            getConfig().endpoints.filter(
              (endpoint) => !addedEndpointIds.has(endpoint.id),
            ),
          )
        } catch (failure) {
          rollbackErrors.push(failure)
        }
      }
      for (const file of written)
        await fs.unlink(file).catch((failure) => rollbackErrors.push(failure))
      if (rollbackErrors.length)
        throw new Error('恢复失败，部分新增数据未能清理，请检查磁盘状态')
      throw error
    }
    return {
      taskCount: tasks.length,
      folderCount: folders.length,
      imageCount: backup.assets.length,
      endpointCount: addedEndpointIds.size,
      downloadedTaskIds: backup.downloadedTaskIds.map(
        (id) => maps.task.get(id)!,
      ),
    }
  })
}
