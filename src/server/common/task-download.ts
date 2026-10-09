import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { ZipFile } from 'yazl'
import {
  getDownloadArchivePaths,
  type DownloadFileInfo,
  type TaskDownloadStatus,
} from '../../shared/task-download'
import { GENERATED_IMAGES_DIR } from './static'
import { GENERATED_IMAGES_API_PATH } from './static/enum'
import { taskManager } from './task-manager'

const SESSION_TTL = 15 * 60 * 1000
const MAX_SESSIONS = 32
export interface ZipDownloadEntry {
  filePath?: string
  buffer?: Buffer
  archivePath: string
  size: number
  mtime: Date
  sha256?: string
}
interface Session extends TaskDownloadStatus {
  files: ZipDownloadEntry[]
  name: string
  expiresAt: number
  cancel?: () => void
}
const sessions = new Map<string, Session>()

function findSession(token: string) {
  for (const [id, session] of sessions) {
    if (session.state !== 'running' && session.expiresAt < Date.now())
      sessions.delete(id)
  }
  return sessions.get(token)
}

/** Resolve only task-owned generated images; never fetch arbitrary URLs. */
async function resolveImage(
  url: string,
  archivePath: string,
): Promise<ZipDownloadEntry> {
  const prefix = `${GENERATED_IMAGES_API_PATH}/`
  const filename = url.startsWith(prefix)
    ? decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0])
    : ''
  if (
    !filename ||
    /[\\/:*?"<>|\u0000-\u001f]/.test(filename) ||
    filename === '.' ||
    filename === '..'
  )
    throw new Error(`图片地址错误：${archivePath}`)
  try {
    const root = await fs.realpath(GENERATED_IMAGES_DIR)
    const filePath = await fs.realpath(path.join(root, filename))
    const relative = path.relative(root, filePath)
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Invalid image path')
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) throw new Error('Not a file')
    await fs.access(filePath, constants.R_OK)
    return { filePath, archivePath, size: stat.size, mtime: stat.mtime }
  } catch {
    throw new Error(`图片文件读取失败（文件不存在或无权限）：${archivePath}`)
  }
}

export async function prepareTaskDownload(
  ids: string[],
  name: string,
  language: 'zh-CN' | 'en-US',
) {
  findSession('')
  const { tasks, folders } = await taskManager.getBackupSnapshot()
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]))
  const files: DownloadFileInfo[] = []
  for (const id of new Set(ids)) {
    const task = byId.get(id)
    if (!task || task.status !== 'completed' || !task.outputUrls?.length)
      throw new Error(`任务下载失败（任务不存在或没有可下载图片）：${id}`)
    const baseName =
      task.rawTemplate?.title || task.rawTemplate?.prompt || `task_${id}`
    task.outputUrls.forEach((url, index) =>
      files.push({
        id: `${id}_${index}`,
        url,
        fileName:
          task.outputUrls!.length > 1 ? `${baseName}_${index + 1}` : baseName,
        endpointName: task.endpointName,
        createdAt: task.createdAt,
        folder: task.folderId ? folderNames.get(task.folderId) : undefined,
      }),
    )
  }
  if (!files.length) throw new Error('没有需要下载的文件')
  const paths = getDownloadArchivePaths(
    files,
    language === 'en-US' ? 'Unknown endpoint' : '未知端点',
  )
  const entries: ZipDownloadEntry[] = []
  // Preflight metadata only, without loading any image into memory.
  for (let i = 0; i < files.length; i++)
    entries.push(await resolveImage(files[i].url, paths[i]))
  return createZipDownloadSession(entries, name)
}

export function createZipDownloadSession(
  entries: ZipDownloadEntry[],
  name: string,
) {
  findSession('')
  // Finished sessions retain only the file plan (and small backup manifest)
  // for browser retries, and can make room for new work.
  if (sessions.size >= MAX_SESSIONS) {
    const finished = [...sessions].find(([, session]) =>
      ['completed', 'failed'].includes(session.state),
    )
    if (finished) sessions.delete(finished[0])
  }
  if (sessions.size >= MAX_SESSIONS) throw new Error('下载请求过多，请稍后重试')
  const token = randomUUID()
  sessions.set(token, {
    files: entries,
    name:
      name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 160) || 'tasks',
    state: 'ready',
    completedFiles: 0,
    totalFiles: entries.length,
    expiresAt: Date.now() + SESSION_TTL,
  })
  return { token, totalFiles: entries.length }
}

export function getTaskDownloadStatus(
  token: string,
): TaskDownloadStatus | undefined {
  const session = findSession(token)
  if (!session) return undefined
  const { state, completedFiles, totalFiles, error } = session
  return { state, completedFiles, totalFiles, error }
}

export function streamTaskDownload(
  token: string,
  headOnly = false,
): Response | undefined {
  const session = findSession(token)
  if (!session) return undefined
  if (!headOnly) {
    // Native download managers may restart the same URL after a disconnect.
    // Stop an older attempt before replacing it; never reject a retry as 404.
    session.cancel?.()
    session.state = 'running'
    session.completedFiles = 0
    session.error = undefined
  }
  let active = !headOnly
  const zip = new ZipFile()
  const output = zip.outputStream as Readable
  const inputs = new Set<Readable>()
  const fail = (error: Error) => {
    if (!active) return
    active = false
    session.cancel = undefined
    session.state = 'failed'
    session.error = error.message
    session.expiresAt = Date.now() + SESSION_TTL
    for (const input of inputs) input.destroy()
    // Stops yazl from opening subsequent entries after cancellation or failure.
    zip.emit('error', error)
    output.destroy(error)
  }
  if (!headOnly) session.cancel = () => fail(new Error('下载已中断，请重试'))
  zip.on('error', (error: Error) => fail(error))
  output.on('error', (error: Error) => fail(error))
  output.once('close', () => fail(new Error('下载已中断，请重试')))
  output.once('end', () => {
    if (!active) return
    active = false
    session.cancel = undefined
    session.state = 'completed'
    session.expiresAt = Date.now() + SESSION_TTL
  })
  for (const entry of session.files) {
    zip.addReadStreamLazy(
      entry.archivePath,
      {
        size: entry.size,
        mtime: entry.mtime,
        compress: false,
      },
      (callback) => {
        if (!active) return
        const source = entry.buffer
          ? Readable.from([entry.buffer])
          : createReadStream(entry.filePath!)
        let input: Readable = source
        if (entry.sha256) {
          const hash = createHash('sha256')
          const verifier = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              hash.update(chunk)
              callback(null, chunk)
            },
            flush(callback) {
              callback(
                hash.digest('hex') === entry.sha256
                  ? null
                  : new Error('备份图片校验失败（文件在打包过程中发生变化）'),
              )
            },
          })
          input = verifier
          inputs.add(source)
          source.once('close', () => inputs.delete(source))
          source.once('error', () =>
            fail(new Error(`文件读取失败：${entry.archivePath}`)),
          )
          source.pipe(verifier)
        }
        inputs.add(input)
        input.once('close', () => inputs.delete(input))
        input.once('error', () =>
          fail(new Error(`文件读取失败：${entry.archivePath}`)),
        )
        input.once('end', () => {
          if (active) session.completedFiles++
        })
        callback(null, input)
      },
    )
  }
  let contentLength: number | undefined
  // @types/yazl omits the callback's size argument. All entries have known sizes.
  // yazl 3.3.1 predicts a ZIP64 footer once the central directory reaches
  // 65,535 bytes, but only emits it at 4 GiB. Force the footer so its predicted
  // Content-Length matches the actual stream, including long-name task lists.
  zip.end({ forceZip64Format: true, comment: '' }, (...[size]: number[]) => {
    contentLength = size
  })
  const encodedName = encodeURIComponent(`${session.name}.zip`).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16)}`,
  )
  return new Response(
    headOnly
      ? null
      : (Readable.toWeb(output, {
          // Older Node versions default to counting chunks. With a 64 KiB HWM that
          // can queue thousands of MiB and report completion far ahead of the client.
          // Always bound the Web-stream queue in bytes, regardless of runtime version.
          strategy: {
            highWaterMark: 64 * 1024,
            size: (chunk: Uint8Array) => chunk.byteLength,
          },
        }) as ReadableStream<Uint8Array>),
    {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="tasks.zip"; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'no-store, no-transform',
        // A generated ZIP cannot seek. Ignore Range and restart with a full 200
        // response instead of claiming byte-range support or returning 404.
        'Accept-Ranges': 'none',
        'X-Accel-Buffering': 'no',
        ...(contentLength !== undefined && contentLength >= 0
          ? { 'Content-Length': String(contentLength) }
          : {}),
      },
    },
  )
}
