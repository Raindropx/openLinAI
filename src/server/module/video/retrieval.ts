import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { VideoRetrievalCheckpoint } from '../../../shared/video'
import { openRemoteVideo } from './remote'
import {
  openPartialVideo,
  videoFilePath,
  videoMaxBytes,
  videoStorageRoot,
  VideoTransfer,
} from './storage'

type Progress = {
  checkpoint?: VideoRetrievalCheckpoint
  bytes: number
  total?: number
  mimeType?: 'video/mp4' | 'video/webm'
  notice?: string
}

const strongEtag = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 1000 &&
  /^"[\x21\x23-\x7e]*"$/.test(value)
const validHead = (head: Buffer) =>
  (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') ||
  (head.length >= 4 &&
    head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))

/** Resume only a synced, hashed prefix of the same URL and strong entity tag. */
export async function retrieveVideoPart(options: {
  id: string
  root: string
  url: string
  signal: AbortSignal
  checkpoint?: VideoRetrievalCheckpoint
  open: typeof openRemoteVideo
  save: (progress: Progress) => Promise<void>
}) {
  const { id, root, url, signal, open, save } = options
  const filePath = videoFilePath(root, id, true)
  const urlHash = createHash('sha256').update(url).digest('hex')
  let checkpoint = options.checkpoint
  let file: Awaited<ReturnType<typeof fs.open>> | undefined
  let response: IncomingMessage | undefined
  let hash = createHash('sha256')
  let head = Buffer.alloc(0)
  let bytes = 0
  let total: number | undefined
  let etag: string | undefined
  let mimeType: 'video/mp4' | 'video/webm' | undefined
  let notice: string | undefined
  let pendingWrite = Promise.resolve()
  let lastSave = Date.now()
  let completed = false

  async function discard() {
    // Clear the old identity before replacing bytes, including across a process crash.
    checkpoint = undefined
    await save({ bytes: 0, notice })
    await file?.close()
    file = undefined
    await fs.rm(filePath, { force: true })
    bytes = 0
    head = Buffer.alloc(0)
    hash = createHash('sha256')
  }

  async function persist() {
    if (!file) return
    // A complete file is committed only after VideoTransfer has checked its final length/header.
    if (
      strongEtag(etag) &&
      total &&
      bytes > 0 &&
      bytes < total &&
      validHead(head)
    ) {
      await file.sync()
      const next = {
        bytes,
        totalBytes: total,
        etag,
        urlHash,
        sha256: hash.copy().digest('hex'),
        mimeType: mimeType!,
      }
      await save({ bytes, total, checkpoint: next, mimeType, notice })
      checkpoint = next
    } else {
      await save({ bytes, total, checkpoint, mimeType, notice })
    }
    lastSave = Date.now()
  }

  try {
    if (checkpoint) {
      try {
        if (
          checkpoint.urlHash !== urlHash ||
          !strongEtag(checkpoint.etag) ||
          checkpoint.bytes <= 0 ||
          checkpoint.bytes >= checkpoint.totalBytes ||
          checkpoint.totalBytes > videoMaxBytes()
        )
          throw new Error('stale checkpoint')
        const opened = await openPartialVideo(root, id)
        file = opened.handle
        if (opened.stat.size < checkpoint.bytes)
          throw new Error('truncated prefix')
        const buffer = Buffer.alloc(64 * 1024)
        while (bytes < checkpoint.bytes) {
          signal.throwIfAborted()
          const read = await file.read(
            buffer,
            0,
            Math.min(buffer.length, checkpoint.bytes - bytes),
            bytes,
          )
          if (!read.bytesRead) throw new Error('truncated prefix')
          const chunk = buffer.subarray(0, read.bytesRead)
          hash.update(chunk)
          if (head.length < 16)
            head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)])
          bytes += read.bytesRead
        }
        if (!validHead(head) || hash.copy().digest('hex') !== checkpoint.sha256)
          throw new Error('changed prefix')
        // Unsynced bytes after the last committed checkpoint are never trusted.
        await file.truncate(bytes)
      } catch (error) {
        if (signal.aborted) throw error
        notice = '断点已失效或下载地址已变化，已从头取回'
        await discard()
      }
    } else {
      await discard()
    }
    signal.throwIfAborted()
    response = await open(
      url,
      signal,
      checkpoint ? { offset: bytes, etag: checkpoint.etag } : undefined,
    )
    if (checkpoint) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
        response.headers['content-range'] || '',
      )
      const length = response.headers['content-length']
      const matches =
        response.statusCode === 206 &&
        range &&
        Number(range[1]) === bytes &&
        Number(range[2]) === checkpoint.totalBytes - 1 &&
        Number(range[3]) === checkpoint.totalBytes &&
        response.headers.etag === checkpoint.etag &&
        response.headers['content-type']?.split(';')[0].trim().toLowerCase() ===
          checkpoint.mimeType &&
        (length === undefined ||
          Number(length) === checkpoint.totalBytes - bytes)
      if (!matches) {
        response.destroy()
        response = undefined
        notice = '云端文件已变化或不支持续传，已从头取回'
        await discard()
        signal.throwIfAborted()
        response = await open(url, signal)
      } else {
        notice = '已从保存的断点继续取回'
      }
    }
    const length = response.headers['content-length']
    total =
      checkpoint?.totalBytes ??
      (length === undefined ? undefined : Number(length))
    if (
      (!checkpoint && response.statusCode !== 200) ||
      (total !== undefined &&
        (!Number.isSafeInteger(total) || total <= 0 || total > videoMaxBytes()))
    )
      throw new Error('invalid video response size/status')
    const mime = response.headers['content-type']
      ?.split(';')[0]
      .trim()
      .toLowerCase()
    if (
      (mime !== 'video/mp4' && mime !== 'video/webm') ||
      (response.headers['content-encoding'] &&
        response.headers['content-encoding'] !== 'identity')
    )
      throw new Error('invalid video response type')
    mimeType = mime
    etag = strongEtag(response.headers.etag) ? response.headers.etag : undefined
    if (!etag || !total) notice = '云端未提供可靠续传信息，中断后将从头取回'
    if (
      root !== (await videoStorageRoot(total === undefined ? 0 : total - bytes))
    )
      throw new Error('storage changed')
    file ??= await fs.open(
      filePath,
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW || 0),
      0o600,
    )
    await save({ bytes, total, checkpoint, mimeType, notice })
    const transfer = new VideoTransfer({
      total,
      offset: bytes,
      head,
      checkSpace: () => videoStorageRoot(),
    })
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        pendingWrite = (async () => {
          let offset = 0
          while (offset < chunk.length) {
            const written = await file!.write(
              chunk,
              offset,
              chunk.length - offset,
              bytes + offset,
            )
            if (!written.bytesWritten) throw new Error('short disk write')
            offset += written.bytesWritten
          }
          hash.update(chunk)
          if (head.length < 16)
            head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)])
          bytes += chunk.length
          if (Date.now() - lastSave >= 5000) await persist()
        })()
        pendingWrite.then(
          () => callback(),
          (error: Error) => callback(error),
        )
      },
    })
    await pipeline(response, transfer, sink, { signal })
    signal.throwIfAborted()
    await file.sync()
    completed = true
    return { bytes, mimeType, sha256: hash.copy().digest('hex') }
  } catch (error) {
    await pendingWrite.catch(() => {})
    // Preserve the previous durable checkpoint if the mount disappeared or a write failed.
    if (root === (await videoStorageRoot(0, false).catch(() => undefined)))
      await persist().catch(() => {})
    throw error
  } finally {
    response?.destroy()
    await file?.close()
    // No usable validator/prefix means there is nothing safe to resume.
    if (
      !completed &&
      !checkpoint &&
      root === (await videoStorageRoot(0, false).catch(() => undefined))
    )
      await fs.rm(filePath, { force: true }).catch(() => {})
  }
}
