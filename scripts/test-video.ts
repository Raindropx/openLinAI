import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import type { VideoRequest } from '../src/shared/video'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-video-test-'))
  const storage = path.join(root, 'external')
  await fs.mkdir(storage)
  process.env.DATA_DIR = root
  process.env.VIDEO_STORAGE_DIR = storage
  process.env.VIDEO_MIN_FREE_BYTES = '1'
  process.env.VIDEO_ALLOWED_HOSTS = 'media.example.com,redirect.example.com'
  const { taskManager, TaskManager } =
    await import('../src/server/common/task-manager')
  const { VideoManager, videoManager } =
    await import('../src/server/module/video/manager')
  const {
    MockVideoProvider,
    videoProviders,
    validateVideoRequest,
    videoRequestSchema,
  } = await import('../src/server/module/video/providers')
  const { VideoTransfer, parseVideoRange, videoFilePath, videoStorageRoot } =
    await import('../src/server/module/video/storage')
  const { isPublicVideoAddress, validateVideoUrl } =
    await import('../src/server/module/video/remote')
  const { serveLocalVideo, videoApi } = await import('../src/server/api/video')
  const { uploadInputImage, getGalleryReferences } =
    await import('../src/server/common/static')
  const { summarizeTask } = await import('../src/server/common/task-pages')
  const { taskListActions } = await import('../src/shared/task-list')
  const provider = new MockVideoProvider(
    'https://media.example.com/movie.mp4?secret=signed',
  )
  videoProviders.set('mock', provider)
  const mockNetwork = {
    validate: async (raw: string) => ({
      url: new URL(raw),
      address: { address: '93.184.216.34', family: 4 },
    }),
    open: async (_raw: string, signal: AbortSignal) => {
      active++
      maxActive = Math.max(maxActive, active)
      const current = mode
      const source = Readable.from(
        (async function* () {
          try {
            yield header
            if (current === 'large') {
              const block = Buffer.alloc(64 * 1024)
              let remaining = 200 * 1024 * 1024 - header.length
              while (remaining) {
                signal.throwIfAborted()
                const length = Math.min(block.length, remaining)
                yield block.subarray(0, length)
                remaining -= length
              }
              return
            }
            if (current === 'slow')
              await new Promise<void>((resolve) => setTimeout(resolve, 150))
            if (current === 'disconnect')
              throw new Error('simulated disconnect')
            for (let i = 0; i < 16; i++) {
              signal.throwIfAborted()
              yield Buffer.alloc(1024, i)
            }
          } finally {
            active--
          }
        })(),
      ) as unknown as Awaited<
        ReturnType<
          typeof import('../src/server/module/video/remote').openRemoteVideo
        >
      >
      source.headers = {
        'content-type': 'video/mp4',
        ...(current === 'unknown'
          ? {}
          : {
              'content-length': String(
                current === 'large'
                  ? 200 * 1024 * 1024
                  : size + (current === 'mismatch' ? 1 : 0),
              ),
            }),
      }
      source.statusCode = 200
      return source
    },
  }
  let manager = new VideoManager(mockNetwork)
  let mode = 'normal',
    active = 0,
    maxActive = 0
  const header = Buffer.from([
    0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
  ])
  const size = header.length + 16 * 1024
  const request: VideoRequest = {
    provider: 'mock',
    model: 'mock-video',
    generationType: 'text_to_video',
    prompt: 'camera pans slowly',
    inputImages: [],
    durationSeconds: 5,
    resolution: '720p',
    aspectRatio: '16:9',
  }

  async function waitFor(check: () => Promise<boolean>, label: string) {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
    throw new Error(`Timed out: ${label}`)
  }
  async function complete() {
    const task = await manager.create(request)
    await taskManager.mutateVideoTask(task.id, (video) => {
      video.remoteTaskId = `0:${task.id}`
      video.generationStatus = 'processing'
    })
    await manager.tick()
    await waitFor(
      async () =>
        (await manager.task(task.id)).video.generationStatus === 'succeeded',
      'generation completion',
    )
    return task.id
  }
  async function retrieve(id: string, expected: string) {
    await manager.queueRetrieval(id)
    await manager.tick()
    await waitFor(
      async () => (await manager.task(id)).video.retrievalStatus === expected,
      `retrieval ${expected}`,
    )
  }
  try {
    // URL/IP policy: host allowlist, redirects' target policy, private DNS and rebinding target.
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '192.168.1.1',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      '2002:7f00:1::1',
      '2001:db8::1',
    ])
      assert.equal(isPublicVideoAddress(address), false, address)
    assert.equal(isPublicVideoAddress('93.184.216.34'), true)
    assert.equal(isPublicVideoAddress('2606:4700:4700::1111'), true)
    for (const raw of [
      'http://media.example.com/x',
      'https://127.0.0.1/x',
      'https://media.example.com:8443/x',
      'https://evil.example/x',
      'https://user:password@media.example.com/x',
    ])
      await assert.rejects(validateVideoUrl(raw))
    await assert.rejects(
      validateVideoUrl('https://redirect.example.com/private', async () => [
        { address: '10.0.0.1', family: 4 },
      ]),
    )
    const pinned = await validateVideoUrl(
      'https://media.example.com/x',
      async () => [{ address: '93.184.216.34', family: 4 }],
    )
    assert.equal(pinned.address.address, '93.184.216.34')
    assert.throws(() => videoFilePath(storage, '../escape'))
    assert.throws(() =>
      videoRequestSchema.parse({
        ...request,
        arbitraryUrl: 'http://127.0.0.1',
      }),
    )
    assert.throws(() =>
      validateVideoRequest({ ...request, durationSeconds: 99 }, provider),
    )
    assert.throws(() =>
      validateVideoRequest(
        { ...request, generationType: 'image_to_video' },
        provider,
      ),
    )

    const rawImage = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#277bb0' },
    })
      .png()
      .toBuffer()
    const input = await uploadInputImage(
      `data:image/png;base64,${rawImage.toString('base64')}`,
    )
    const i2v = await manager.create({
      ...request,
      generationType: 'image_to_video',
      inputImages: [input.url],
    })
    assert.equal(i2v.video!.request.inputImages[0], input.url)
    assert.ok(
      (await getGalleryReferences()).taskUrls.includes(input.url),
      'reference input is protected from gallery cleanup',
    )
    const firstLast = await manager.create({
      ...request,
      generationType: 'image_to_video',
      inputImages: [input.url, input.url],
      frameMode: 'first_last_frame',
      frames: { firstImageUrl: input.url, lastImageUrl: input.url },
    })
    assert.equal(firstLast.video!.request.frames!.lastImageUrl, input.url)
    await taskManager.mutateVideoTask(firstLast.id, (video) => {
      video.generationStatus = 'cancelled'
    })
    await assert.rejects(
      manager.create({
        ...request,
        generationType: 'image_to_video',
        inputImages: [input.url],
        frameMode: 'first_last_frame',
      }),
    )
    await assert.rejects(
      manager.create({
        ...request,
        generationType: 'reference_to_video',
        inputImages: [input.url],
        references: [{ type: 'image', imageUrl: input.url }],
        frames: { firstImageUrl: input.url },
      }),
    )
    const ref = await manager.create({
      ...request,
      generationType: 'reference_to_video',
      inputImages: [input.url],
      references: [
        { type: 'audio', remoteUrl: 'https://media.example.com/voice.mp3' },
        { type: 'image', imageUrl: input.url },
        { type: 'video', remoteUrl: 'https://media.example.com/motion.mp4' },
      ],
    })
    assert.deepEqual(
      ref.video!.request.references!.map((entry) => entry.type),
      ['audio', 'image', 'video'],
    )
    await assert.rejects(
      manager.create({
        ...request,
        generationType: 'reference_to_video',
        references: [
          { type: 'audio', remoteUrl: 'https://media.example.com/voice.mp3' },
        ],
      }),
    )
    await assert.rejects(
      manager.create({
        ...request,
        generationType: 'image_to_video',
        inputImages: ['/api/static/images/input/../../bad.png'],
      }),
    )

    // Remote queue, processing, success and persisted remote ID; retries query existing remote task.
    for (const id of [i2v.id, ref.id])
      await taskManager.mutateVideoTask(id, (video) => {
        video.generationStatus = 'cancelled'
      })
    const queued = await manager.create(request)
    await manager.tick()
    await waitFor(
      async () => !!(await manager.task(queued.id)).video.remoteTaskId,
      'remote ID persisted',
    )
    assert.notEqual(
      (await manager.task(queued.id)).video.generationStatus,
      'succeeded',
    )
    await manager.stop()
    manager = new VideoManager(mockNetwork)
    await taskManager.mutateVideoTask(queued.id, (video) => {
      video.generationStatus = 'failed'
    })
    const remoteId = (await manager.task(queued.id)).video.remoteTaskId
    await manager.retryGeneration(queued.id)
    assert.equal((await manager.task(queued.id)).video.remoteTaskId, remoteId)
    assert.equal(
      (await new TaskManager().getTasks()).find(
        (task) => task.id === queued.id,
      )!.status,
      'running',
      'video task survives ordinary TaskManager recovery',
    )
    await taskManager.mutateVideoTask(queued.id, (video) => {
      video.generationStatus = 'submitting'
      video.remoteTaskId = undefined
    })
    await manager.recover()
    assert.equal(
      (await manager.task(queued.id)).video.generationStatus,
      'failed',
      'uncertain submission is not automatically repeated',
    )
    for (const id of [i2v.id, ref.id])
      await taskManager.mutateVideoTask(id, (video) => {
        video.generationStatus = 'cancelled'
      })

    const id = await complete()
    const timedOut = await manager.create(request)
    await taskManager.mutateVideoTask(timedOut.id, (video) => {
      video.generationDeadlineAt = Date.now() - 1
    })
    await manager.tick()
    assert.equal(
      (await manager.task(timedOut.id)).video.generationStatus,
      'failed',
    )
    const cloud = await manager.sources(id)
    assert.equal(cloud.source, 'cloud')
    assert.equal(cloud.playbackUrl, provider['resultUrl'])
    assert.match(cloud.downloadUrl!, /cloud-download$/)
    const summary = summarizeTask(await manager.task(id))
    assert.ok(summary.video)
    assert.deepEqual(taskListActions(summary), {
      addToTemplate: false,
      refill: false,
      retry: false,
    })
    await retrieve(id, 'retrieved')
    assert.equal((await manager.task(id)).video.generationStatus, 'succeeded')
    assert.equal((await fs.stat(videoFilePath(storage, id))).size, size)
    assert.equal((await manager.sources(id)).source, 'local')
    await assert.rejects(fs.stat(videoFilePath(storage, id, true)), {
      code: 'ENOENT',
    })

    const range = await serveLocalVideo(id, { range: 'bytes=0-1023' })
    assert.equal(range.status, 206)
    assert.equal(range.headers.get('Content-Range'), `bytes 0-1023/${size}`)
    assert.equal(range.headers.get('Accept-Ranges'), 'bytes')
    assert.equal((await range.arrayBuffer()).byteLength, 1024)
    for (const invalid of [
      'bytes=999999-',
      'bytes=9-1',
      'bytes=-0',
      'bytes=0-1,3-4',
      'bad',
    ]) {
      const result = await serveLocalVideo(id, { range: invalid })
      assert.equal(result.status, 416, invalid)
      assert.equal(result.headers.get('Content-Range'), `bytes */${size}`)
    }
    assert.deepEqual(parseVideoRange('bytes=-16', size), {
      start: size - 16,
      end: size - 1,
      partial: true,
    })
    const head = await serveLocalVideo(id, { head: true, download: true })
    assert.equal(head.headers.get('Content-Length'), String(size))
    assert.match(head.headers.get('Content-Disposition')!, /^attachment;/)
    assert.equal((await head.arrayBuffer()).byteLength, 0)

    // Missing/offline media falls back to cloud and recovers when the file returns.
    await fs.rename(
      videoFilePath(storage, id),
      videoFilePath(storage, id) + '.offline',
    )
    assert.equal((await manager.sources(id)).source, 'cloud')
    assert.equal((await manager.task(id)).video.retrievalStatus, 'failed')
    await fs.rename(
      videoFilePath(storage, id) + '.offline',
      videoFilePath(storage, id),
    )
    assert.equal((await manager.sources(id)).source, 'local')
    await fs.rename(storage, storage + '-offline')
    await assert.rejects(videoStorageRoot())
    assert.equal((await manager.sources(id)).source, 'cloud')
    await assert.rejects(fs.stat(storage), { code: 'ENOENT' })
    await fs.rename(storage + '-offline', storage)

    // Unknown length, truncation, disconnect, cancellation, concurrency and .part recovery.
    mode = 'unknown'
    const unknown = await complete()
    await retrieve(unknown, 'retrieved')
    mode = 'mismatch'
    const failed = await complete()
    await retrieve(failed, 'failed')
    assert.equal(
      (await manager.task(failed)).video.generationStatus,
      'succeeded',
    )
    await assert.rejects(fs.stat(videoFilePath(storage, failed)), {
      code: 'ENOENT',
    })
    mode = 'disconnect'
    await retrieve(failed, 'failed')
    mode = 'slow'
    const a = await complete(),
      b = await complete()
    maxActive = 0
    await manager.queueRetrieval(a)
    await manager.queueRetrieval(b)
    await manager.tick()
    await waitFor(
      async () =>
        (await manager.task(a)).video.retrievalStatus === 'downloading',
      'download started',
    )
    assert.equal((await manager.task(b)).video.retrievalStatus, 'queued')
    await manager.cancelRetrieval(a)
    assert.equal((await manager.task(a)).video.retrievalStatus, 'cancelled')
    await assert.rejects(fs.stat(videoFilePath(storage, a)), { code: 'ENOENT' })
    await manager.tick()
    await waitFor(
      async () => (await manager.task(b)).video.retrievalStatus === 'retrieved',
      'queued retrieval',
    )
    assert.equal(maxActive, 1)
    mode = 'normal'
    await fs.writeFile(videoFilePath(storage, a, true), 'interrupted')
    await taskManager.mutateVideoTask(a, (video) => {
      video.retrievalStatus = 'downloading'
    })
    await manager.recover()
    await manager.tick()
    await waitFor(
      async () => (await manager.task(a)).video.retrievalStatus === 'retrieved',
      'restart retrieval',
    )
    assert.equal((await fs.stat(videoFilePath(storage, a))).size, size)
    await manager.deleteLocal(a)
    assert.equal((await manager.task(a)).video.retrievalStatus, 'not_retrieved')
    assert.equal((await manager.sources(a)).source, 'cloud')

    const res = await videoApi.request('/capabilities')
    assert.equal(res.status, 200)
    const csrf = await videoApi.request(`/${id}/retrieve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: '{}',
    })
    assert.equal(csrf.status, 403)
    for (const operation of ['pause-retrieval', 'restart-retrieval']) {
      const blocked = await videoApi.request(`/${id}/${operation}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}',
      })
      assert.equal(blocked.status, 403)
    }
    assert.equal((await videoApi.request(`/${randomUUID()}/file`)).status, 400)
    assert.equal(
      (
        await videoApi.request(`/${id}/retrieve`, {
          method: 'POST',
          body: 'url=http://127.0.0.1',
        })
      ).status,
      415,
    )
    await assert.rejects(manager.task(randomUUID()))
    process.env.VIDEO_MAX_FILE_BYTES = '10'
    await assert.rejects(
      pipeline(
        Readable.from([header]),
        new VideoTransfer({}),
        new Writable({
          write(_chunk, _encoding, done) {
            done()
          },
        }),
      ),
    )
    delete process.env.VIDEO_MAX_FILE_BYTES

    // Stream 200 MiB through the complete retrieval pipeline into an actual external-directory file.
    mode = 'large'
    const large = await complete()
    const startRss = process.memoryUsage().rss
    let peakRss = startRss
    const total = 200 * 1024 * 1024
    const sampling = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
    }, 5)
    try {
      await retrieve(large, 'retrieved')
    } finally {
      clearInterval(sampling)
    }
    assert.equal((await fs.stat(videoFilePath(storage, large))).size, total)
    assert.ok(
      peakRss - startRss < 96 * 1024 * 1024,
      `RSS grew by ${peakRss - startRss}`,
    )
    const { createTaskBackup, restoreTaskBackup } =
      await import('../src/server/common/task-backup')
    const originalIds = new Set(
      (await taskManager.getTasks()).map((task) => task.id),
    )
    const backup = await createTaskBackup()
    assert.ok(
      backup.length < 1024 * 1024,
      'video backup contains metadata, not the 200 MiB video',
    )
    await restoreTaskBackup(backup)
    const restored = (await taskManager.getTasks()).filter(
      (task) => !originalIds.has(task.id) && task.video,
    )
    assert.ok(restored.length)
    for (const task of restored) {
      assert.equal(task.video!.retrievalStatus, 'not_retrieved')
      assert.equal(task.video!.result?.localFileId, undefined)
      assert.equal(task.video!.retrievalCheckpoint, undefined)
      assert.equal(task.video!.retrievalCommit, undefined)
    }
    console.log(
      `Video integration passed: modes/references, persistence/recovery, independent states, retrieval, cancellation/limits, sources, Range/HEAD/download, URL/path policy, CSRF. 200 MiB stream RSS delta: ${((peakRss - startRss) / 1024 / 1024).toFixed(1)} MiB.`,
    )
  } finally {
    await manager.stop()
    await videoManager.stop()
    await fs.rm(root, { recursive: true, force: true })
  }
}
let finished = false
process.on('beforeExit', () => {
  if (!finished) {
    console.error('Video test exited with unfinished asynchronous work')
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
