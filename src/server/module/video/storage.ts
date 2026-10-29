import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { TransformCallback } from 'node:stream'
import { Transform } from 'node:stream'

export const videoMaxBytes = () =>
  positiveEnv(
    'VIDEO_MAX_FILE_BYTES',
    1024 * 1024 * 1024,
    8 * 1024 * 1024 * 1024,
  )
export const videoTimeoutMs = () =>
  positiveEnv('VIDEO_TRANSFER_TIMEOUT_MS', 30 * 60 * 1000, 2 * 60 * 60 * 1000)
export function positiveEnv(name: string, fallback: number, max: number) {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, max)
    : fallback
}

/** Never create the configured storage root: a missing mount must fail closed. */
export async function videoStorageRoot(requiredBytes = 0, writing = true) {
  const configured = process.env.VIDEO_STORAGE_DIR
  if (!configured || !path.isAbsolute(configured))
    throw new Error('请先配置已存在的外接视频目录 VIDEO_STORAGE_DIR')
  let root: string
  try {
    root = await fs.realpath(configured)
  } catch {
    throw new Error('视频存储不可用：目录不存在或外接磁盘未挂载')
  }
  if (process.platform === 'linux') {
    const mount = process.env.VIDEO_STORAGE_MOUNT
    if (!mount || !path.isAbsolute(mount))
      throw new Error('Linux 取回必须配置 VIDEO_STORAGE_MOUNT 外接挂载点')
    const canonicalMount = await fs.realpath(mount)
    if (canonicalMount === '/' || !inside(canonicalMount, root))
      throw new Error('视频目录不在指定外接挂载点内')
    const mountinfo = await fs.readFile('/proc/self/mountinfo', 'utf8')
    const mounted = mountinfo.split('\n').some((line) => {
      const fields = line.split(' ')
      const target = fields[4]?.replace(/\\([0-7]{3})/g, (_, octal: string) =>
        String.fromCharCode(parseInt(octal, 8)),
      )
      return target === canonicalMount
    })
    if (!mounted) throw new Error('外接视频存储未挂载')
    const info = await fs.statfs(root)
    if ([0x794c7630, 0x01021994].includes(info.type))
      throw new Error('禁止将视频保存到 overlay 或 tmpfs')
    const [disk, system] = await Promise.all([fs.stat(root), fs.stat('/')])
    if (disk.dev === system.dev)
      throw new Error('视频存储不能位于系统根文件系统')
  }
  await fs.access(
    root,
    writing ? constants.W_OK | constants.R_OK : constants.R_OK,
  )
  if (!writing) return root
  const stat = await fs.statfs(root)
  const reserve = positiveEnv(
    'VIDEO_MIN_FREE_BYTES',
    128 * 1024 * 1024,
    1024 * 1024 * 1024,
  )
  if (stat.bavail * stat.bsize < requiredBytes + reserve)
    throw new Error('外接存储可用空间不足')
  return root
}

function inside(root: string, file: string) {
  const relative = path.relative(root, file)
  return (
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  )
}

export function videoFilePath(root: string, id: string, part = false) {
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id))
    throw new Error('无效的视频文件编号')
  return path.join(root, `${id}.${part ? 'part' : 'video'}`)
}

export async function openLocalVideo(id: string) {
  const root = await videoStorageRoot(0, false)
  const file = videoFilePath(root, id)
  const resolved = await fs.realpath(file)
  if (!inside(root, resolved) || (await fs.lstat(file)).isSymbolicLink())
    throw new Error('视频文件路径不安全')
  const handle = await fs.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  )
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || !stat.size) throw new Error('本地视频文件不可用')
    return { handle, stat }
  } catch (error) {
    await handle.close()
    throw error
  }
}

export function parseVideoRange(range: string | undefined, size: number) {
  if (!range) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (!match[1] && !match[2])) throw new Error('无效 Range')
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end =
    match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    start > end ||
    (!match[1] && Number(match[2]) === 0)
  )
    throw new Error('无效 Range')
  start = Math.max(0, start)
  return { start, end, partial: true }
}

/** Bounds memory to stream buffers, validates the container header and exact known length. */
export class VideoTransfer extends Transform {
  bytes = 0
  private head = Buffer.alloc(0)
  private nextSpaceCheck = 4 * 1024 * 1024
  constructor(
    private options: {
      total?: number
      max?: number
      checkSpace?: () => Promise<unknown>
      progress?: (bytes: number) => void
    },
  ) {
    super()
  }
  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ) {
    this.bytes += chunk.length
    if (
      this.bytes > (this.options.max ?? videoMaxBytes()) ||
      (this.options.total !== undefined && this.bytes > this.options.total)
    ) {
      callback(new Error('视频大小超出限制或传输长度不符'))
      return
    }
    if (this.head.length < 16)
      this.head = Buffer.concat([
        this.head,
        chunk.subarray(0, 16 - this.head.length),
      ])
    this.options.progress?.(this.bytes)
    if (this.options.checkSpace && this.bytes >= this.nextSpaceCheck) {
      this.nextSpaceCheck = this.bytes + 4 * 1024 * 1024
      this.options.checkSpace().then(
        () => callback(null, chunk),
        (error: Error) => callback(error),
      )
    } else callback(null, chunk)
  }
  _flush(callback: TransformCallback) {
    const mp4 =
      this.head.length >= 12 && this.head.toString('ascii', 4, 8) === 'ftyp'
    const webm = this.head
      .subarray(0, 4)
      .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    if (!this.bytes || (!mp4 && !webm)) callback(new Error('视频容器头无效'))
    else if (
      this.options.total !== undefined &&
      this.bytes !== this.options.total
    )
      callback(new Error('视频传输不完整'))
    else callback()
  }
}
