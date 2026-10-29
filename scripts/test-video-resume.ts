import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { VideoRangeRequest } from '../src/server/module/video/remote'
import type { VideoRequest } from '../src/shared/video'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-video-resume-'))
  const storage = path.join(root, 'external')
  await fs.mkdir(storage)
  process.env.DATA_DIR = root
  process.env.VIDEO_STORAGE_DIR = storage
  process.env.VIDEO_MIN_FREE_BYTES = '1'
  const { taskManager, TaskManager } =
    await import('../src/server/common/task-manager')
  const { VideoManager } = await import('../src/server/module/video/manager')
  const { MockVideoProvider, videoProviders } =
    await import('../src/server/module/video/providers')
  const { videoFilePath } = await import('../src/server/module/video/storage')
  const { videoTaskSchema } = await import('../src/shared/video')
  const url = 'https://media.example.com/movie.mp4?signature=one'
  videoProviders.set('mock', new MockVideoProvider(url))
  const payload = Buffer.alloc(256 * 1024)
  Buffer.from([
    0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
  ]).copy(payload)
  for (let i = 16; i < payload.length; i++) payload[i] = i % 251
  let mode = 'normal'
  let requests: Array<VideoRangeRequest | undefined> = []
  const network = {
    validate: async (raw: string) => ({
      url: new URL(raw),
      address: { address: '93.184.216.34', family: 4 },
    }),
    open: async (
      _raw: string,
      signal: AbortSignal,
      range?: VideoRangeRequest,
    ) => {
      requests.push(range)
      const current = mode
      const offset = range && current !== 'ignore' ? range.offset : 0
      const source = Readable.from(
        (async function* () {
          for (let i = offset; i < payload.length; i += 4096) {
            signal.throwIfAborted()
            if (current.startsWith('disconnect') && i >= 16384)
              throw new Error('network disconnected')
            yield payload.subarray(i, i + 4096)
            await new Promise((resolve) => setTimeout(resolve, 2))
          }
        })(),
      ) as unknown as Awaited<
        ReturnType<
          typeof import('../src/server/module/video/remote').openRemoteVideo
        >
      >
      source.statusCode = range
        ? current === 'ignore'
          ? 200
          : current === '416'
            ? 416
            : 206
        : 200
      source.headers = {
        'content-type': 'video/mp4',
        'content-length': String(payload.length - offset),
        ...(current === 'disconnect-weak'
          ? { etag: 'W/"v1"' }
          : { etag: current === 'changed' ? '"v2"' : '"v1"' }),
        ...(range
          ? {
              'content-range': `bytes ${current === 'bad-range' ? offset + 1 : offset}-${payload.length - 1}/${payload.length}`,
            }
          : {}),
      }
      return source
    },
  }
  let manager = new VideoManager(network)
  const input: VideoRequest = {
    provider: 'mock',
    model: 'mock-video',
    generationType: 'text_to_video',
    prompt: 'resume test',
    inputImages: [],
    durationSeconds: 5,
    resolution: '720p',
    aspectRatio: '16:9',
  }
  async function wait(check: () => Promise<boolean>, label: string) {
    const until = Date.now() + 10000
    while (Date.now() < until) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`Timeout: ${label}`)
  }
  async function task() {
    const created = await manager.create(input)
    await taskManager.mutateVideoTask(created.id, (video) => {
      video.generationStatus = 'succeeded'
      video.remoteTaskId = `0:${created.id}`
      video.result = { remoteUrl: url }
    })
    return created.id
  }
  async function run(id: string, status: string) {
    await manager.queueRetrieval(id)
    await manager.tick()
    await wait(
      async () => (await manager.task(id)).video.retrievalStatus === status,
      status,
    )
  }
  async function partial() {
    mode = 'disconnect'
    const id = await task()
    await run(id, 'failed')
    const checkpoint = (await manager.task(id)).video.retrievalCheckpoint!
    assert.ok(checkpoint?.bytes > 0 && checkpoint.bytes < payload.length)
    assert.equal(
      checkpoint.sha256,
      createHash('sha256')
        .update(payload.subarray(0, checkpoint.bytes))
        .digest('hex'),
    )
    assert.equal(
      videoTaskSchema.parse((await manager.task(id)).video).retrievalCheckpoint
        ?.bytes,
      checkpoint.bytes,
    )
    return { id, checkpoint }
  }
  async function verify(id: string) {
    assert.deepEqual(
      await fs.readFile(videoFilePath(storage, id)),
      payload,
      'assembled file matches original byte for byte',
    )
    assert.equal((await manager.task(id)).video.retrievalCheckpoint, undefined)
    await assert.rejects(fs.stat(videoFilePath(storage, id, true)), {
      code: 'ENOENT',
    })
  }
  try {
    // Real partial file + persisted metadata; retry requests exactly the missing suffix.
    const first = await partial()
    mode = 'normal'
    requests = []
    await run(first.id, 'retrieved')
    assert.deepEqual(requests, [
      { offset: first.checkpoint.bytes, etag: '"v1"' },
    ])
    await verify(first.id)

    for (const fallback of ['ignore', 'changed', 'bad-range', '416']) {
      const item = await partial()
      mode = fallback
      requests = []
      await run(item.id, 'retrieved')
      assert.equal(requests.length, 2, fallback)
      assert.equal(requests[0]?.offset, item.checkpoint.bytes)
      assert.equal(requests[1], undefined)
      await verify(item.id)
    }

    // Local prefix corruption, short files, and renewed signed URLs must not be stitched.
    for (const invalid of ['corrupt', 'truncated', 'url']) {
      const item = await partial()
      if (invalid === 'corrupt') {
        const data = await fs.readFile(videoFilePath(storage, item.id, true))
        data[20] ^= 255
        await fs.writeFile(videoFilePath(storage, item.id, true), data)
      } else if (invalid === 'truncated') {
        await fs.truncate(videoFilePath(storage, item.id, true), 2)
      } else {
        await taskManager.mutateVideoTask(item.id, (video) => {
          video.result!.remoteUrl = url + 'new'
        })
      }
      mode = 'normal'
      requests = []
      await run(item.id, 'retrieved')
      assert.deepEqual(requests, [undefined], invalid)
      await verify(item.id)
    }

    const weak = await task()
    mode = 'disconnect-weak'
    await run(weak, 'failed')
    assert.equal(
      (await manager.task(weak)).video.retrievalCheckpoint,
      undefined,
    )
    await assert.rejects(fs.stat(videoFilePath(storage, weak, true)), {
      code: 'ENOENT',
    })

    // Pause while bytes are being written; paused survives recovery and doesn't auto-run.
    const paused = await task()
    mode = 'normal'
    await manager.queueRetrieval(paused)
    await manager.tick()
    await wait(
      async () =>
        (
          await fs
            .stat(videoFilePath(storage, paused, true))
            .catch(() => ({ size: 0 }))
        ).size >= 8192,
      'partial bytes',
    )
    await manager.pauseRetrieval(paused)
    assert.equal((await manager.task(paused)).video.retrievalStatus, 'paused')
    assert.ok((await manager.task(paused)).video.retrievalCheckpoint)
    await manager.recover()
    await manager.tick()
    assert.equal((await manager.task(paused)).video.retrievalStatus, 'paused')
    requests = []
    await run(paused, 'retrieved')
    assert.ok(requests[0]?.offset)
    await verify(paused)

    // Shutdown preserves queued work; a new manager resumes the durable checkpoint.
    const shutdown = await task()
    await manager.queueRetrieval(shutdown)
    await manager.tick()
    await wait(
      async () =>
        (
          await fs
            .stat(videoFilePath(storage, shutdown, true))
            .catch(() => ({ size: 0 }))
        ).size >= 8192,
      'shutdown bytes',
    )
    await manager.stop()
    const saved = (await new TaskManager().getTasks()).find(
      (task) => task.id === shutdown,
    )!.video!
    assert.equal(saved.retrievalStatus, 'queued')
    assert.ok(saved.retrievalCheckpoint)
    // Simulate uncommitted bytes left by a crash after the last synced checkpoint.
    await fs.appendFile(
      videoFilePath(storage, shutdown, true),
      Buffer.from('uncommitted bytes'),
    )
    manager = new VideoManager(network)
    await manager.recover()
    requests = []
    await manager.tick()
    await wait(
      async () =>
        (await manager.task(shutdown)).video.retrievalStatus === 'retrieved',
      'restart',
    )
    assert.equal(requests[0]?.offset, saved.retrievalCheckpoint!.bytes)
    await verify(shutdown)

    const cancelled = await partial()
    await manager.cancelRetrieval(cancelled.id)
    assert.equal(
      (await manager.task(cancelled.id)).video.retrievalStatus,
      'cancelled',
    )
    assert.equal(
      (await manager.task(cancelled.id)).video.retrievalCheckpoint,
      undefined,
    )
    await assert.rejects(fs.stat(videoFilePath(storage, cancelled.id, true)), {
      code: 'ENOENT',
    })

    const restarted = await partial()
    mode = 'normal'
    requests = []
    await manager.restartRetrieval(restarted.id)
    await manager.tick()
    await wait(
      async () =>
        (await manager.task(restarted.id)).video.retrievalStatus ===
        'retrieved',
      'explicit restart',
    )
    assert.deepEqual(requests, [undefined])
    await verify(restarted.id)

    // Preserve verified final-file recovery when requeueing after rename/catalog interruption.
    const renamed = await task()
    await fs.writeFile(videoFilePath(storage, renamed), payload)
    await taskManager.mutateVideoTask(renamed, (video) => {
      video.retrievalTotalBytes = payload.length
      video.retrievalCommit = {
        bytes: payload.length,
        sha256: createHash('sha256').update(payload).digest('hex'),
        mimeType: 'video/mp4',
      }
      video.retrievalStatus = 'failed'
      video.result!.mimeType = 'video/mp4'
    })
    requests = []
    await run(renamed, 'retrieved')
    assert.equal(requests.length, 0)
    await verify(renamed)
    // Both sides of rename are recoverable, but same-size unverified files are rejected.
    const unrenamed = await task()
    await fs.writeFile(videoFilePath(storage, unrenamed, true), payload)
    await taskManager.mutateVideoTask(unrenamed, (video) => {
      video.retrievalCommit = {
        bytes: payload.length,
        sha256: createHash('sha256').update(payload).digest('hex'),
        mimeType: 'video/mp4',
      }
      video.retrievalStatus = 'failed'
    })
    requests = []
    await run(unrenamed, 'retrieved')
    assert.equal(requests.length, 0)
    await verify(unrenamed)
    for (const badCommit of [
      undefined,
      {
        bytes: payload.length,
        sha256: '0'.repeat(64),
        mimeType: 'video/mp4' as const,
      },
    ]) {
      const untrusted = await task()
      await fs.writeFile(videoFilePath(storage, untrusted), payload)
      await taskManager.mutateVideoTask(untrusted, (video) => {
        video.retrievalTotalBytes = payload.length
        video.retrievalCommit = badCommit
      })
      await run(untrusted, 'failed')
      assert.equal(
        (await manager.task(untrusted)).video.result?.localFileId,
        undefined,
      )
      assert.deepEqual(
        await fs.readFile(videoFilePath(storage, untrusted)),
        payload,
      )
    }

    // Backups must not attach a restored task to another task's partial or completed file.
    const backupPartial = await partial()
    await manager.pauseRetrieval(backupPartial.id)
    const { createTaskBackup, restoreTaskBackup } =
      await import('../src/server/common/task-backup')
    const originals = new Set(
      (await taskManager.getTasks()).map((task) => task.id),
    )
    await restoreTaskBackup(await createTaskBackup())
    const restored = (await taskManager.getTasks()).filter(
      (task) => !originals.has(task.id),
    )
    assert.ok(restored.length)
    for (const restoredTask of restored) {
      assert.equal(restoredTask.video?.retrievalCheckpoint, undefined)
      assert.equal(restoredTask.video?.retrievalCommit, undefined)
      assert.equal(restoredTask.video?.retrievalStatus, 'not_retrieved')
    }
    console.log(
      'Video resume passed: exact suffix, byte equality, changed/ignored/invalid Range/416 fallback, corrupt/truncated prefix, renewed URL, weak validator, pause, restart/shutdown, uncommitted tail, cancel, explicit restart, verified rename recovery, untrusted file rejection, backup isolation.',
    )
  } finally {
    await manager.stop()
    await fs.rm(root, { recursive: true, force: true })
  }
}
let finished = false
process.on('beforeExit', () => {
  if (!finished) {
    console.error('Unfinished video resume test')
    process.exitCode = 1
  }
})
main()
  .then(() => {
    finished = true
  })
  .catch((error) => {
    finished = true
    console.error(error)
    process.exitCode = 1
  })
