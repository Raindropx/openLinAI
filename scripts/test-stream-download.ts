import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import JSZip from 'jszip'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

async function main() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'linai-stream-download-'),
  )
  const previous = process.env.DATA_DIR
  process.env.DATA_DIR = root
  const imageRoot = path.join(root, 'images', 'generated')
  await fs.mkdir(imageRoot, { recursive: true })
  const tasks = Array.from({ length: 420 }, (_, index) => ({
    id: `fixture-${index}`,
    status: 'completed',
    createdAt: 1,
    source: 'fixture',
    folderId: index % 2 ? 'folder' : undefined,
    rawTemplate: {
      id: 'template',
      title: '同名图片',
      prompt: 'fixture',
      images: [],
      usageType: 'image',
      createdAt: 1,
    },
    outputUrls: [`/api/static/images/generated/${index}.png`],
  }))
  await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify(tasks))
  await fs.writeFile(
    path.join(root, 'task-folders.json'),
    JSON.stringify([{ id: 'folder', name: '作品' }]),
  )
  await Promise.all(
    tasks.map((_, index) =>
      fs.writeFile(
        path.join(imageRoot, `${index}.png`),
        new Uint8Array([index % 256, 2, 3]),
      ),
    ),
  )
  const { default: api } = await import('../src/server/api/common/task')
  const {
    createZipDownloadSession,
    getTaskDownloadStatus,
    streamTaskDownload,
  } = await import('../src/server/common/task-download')
  const app = new Hono().route('/api/task', api)
  let ready!: (base: string) => void
  const listening = new Promise<string>((resolve) => {
    ready = resolve
  })
  const server = serve(
    { fetch: app.fetch, port: 0, hostname: '127.0.0.1' },
    (info) => ready(`http://127.0.0.1:${info.port}`),
  )
  try {
    const base = await listening
    const prepare = async (ids: string[]) => {
      const response = await fetch(`${base}/api/task/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, name: '作品_测试', language: 'zh-CN' }),
      })
      return { response, result: await response.json() }
    }
    const { response, result } = await prepare(tasks.map((task) => task.id))
    assert.equal(response.status, 200, JSON.stringify(result))
    assert.equal(result.data.totalFiles, 420)
    const url = `${base}/api/task/download/${result.data.token}`
    const head = await fetch(url, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.ok(Number(head.headers.get('Content-Length')) > 0)
    assert.equal((await head.arrayBuffer()).byteLength, 0)
    assert.equal(getTaskDownloadStatus(result.data.token)?.state, 'ready')
    const download = await fetch(url)
    assert.equal(download.status, 200)
    assert.match(
      download.headers.get('Content-Disposition')!,
      /filename\*=UTF-8''%E4/,
    )
    const bytes = await download.arrayBuffer()
    assert.equal(
      Number(download.headers.get('Content-Length')),
      bytes.byteLength,
    )
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true })
    const entries = Object.values(zip.files).filter((entry) => !entry.dir)
    assert.equal(entries.length, 420)
    assert.equal(
      entries.filter((entry) => entry.name.startsWith('作品/')).length,
      210,
    )
    assert.equal(
      new Set(entries.map((entry) => entry.name.toLowerCase())).size,
      420,
    )
    for (let index = 0; index < entries.length; index++)
      assert.deepEqual(
        await entries[index].async('uint8array'),
        new Uint8Array([index % 256, 2, 3]),
      )
    assert.equal(
      (await (await fetch(`${url}/status`)).json()).data.state,
      'completed',
    )
    const retry = await fetch(url)
    assert.equal(retry.status, 200, 'Native downloads can retry the same URL')
    assert.deepEqual(await retry.arrayBuffer(), bytes)
    const rangeRetry = await fetch(url, { headers: { Range: 'bytes=1024-' } })
    assert.equal(
      rangeRetry.status,
      200,
      'Generated ZIPs restart from byte zero',
    )
    assert.equal(rangeRetry.headers.get('Accept-Ranges'), 'none')
    assert.deepEqual(await rangeRetry.arrayBuffer(), bytes)
    assert.equal((await prepare(['missing'])).response.status, 400)
    // A central directory over 65,535 bytes must not make yazl overestimate
    // Content-Length by the 76-byte ZIP64 footer it otherwise does not emit.
    // Long Chinese task names can cross this threshold with only a few hundred
    // images, regardless of the archive's payload size.
    const longNames = createZipDownloadSession(
      Array.from({ length: 300 }, (_, index) => ({
        buffer: Buffer.from([index % 256]),
        archivePath: `${'较长的任务名称'.repeat(12)}_${index}.png`,
        size: 1,
        mtime: new Date(),
      })),
      'large-central-directory',
    )
    const longNamesResponse = streamTaskDownload(longNames.token)!
    const longNamesBytes = await longNamesResponse.arrayBuffer()
    assert.equal(
      Number(longNamesResponse.headers.get('Content-Length')),
      longNamesBytes.byteLength,
      'Large central directories must declare the exact emitted length',
    )
    const longNamesZip = await JSZip.loadAsync(longNamesBytes, {
      checkCRC32: true,
    })
    assert.equal(Object.keys(longNamesZip.files).length, 300)
    // Exercise the HTTP adapter too: a wrong length makes native download
    // managers wait after the ZIP ends and then reject the download.
    const longNamesHttp = await fetch(
      `${base}/api/task/download/${longNames.token}`,
    )
    assert.equal(
      (await longNamesHttp.arrayBuffer()).byteLength,
      Number(longNamesHttp.headers.get('Content-Length')),
    )
    // Exceed the legacy cap with nine distinct sparse files; consume the ZIP in
    // chunks so this regression test never buffers the whole archive either.
    const largeUrls: string[] = []
    for (let index = 0; index < 9; index++) {
      const filename = `backup-large-${index}.png`
      const handle = await fs.open(path.join(imageRoot, filename), 'wx')
      try {
        await handle.truncate(64 * 1024 * 1024)
        await handle.write(new Uint8Array([index + 1]), 0, 1, 0)
      } finally {
        await handle.close()
      }
      largeUrls.push(`/api/static/images/generated/${filename}`)
    }
    const { taskManager } = await import('../src/server/common/task-manager')
    await taskManager.addCompletedTask({
      ...tasks[0],
      id: 'large-backup',
      status: 'completed',
      outputUrls: largeUrls,
    } as Parameters<typeof taskManager.addCompletedTask>[0])
    const backupPrepare = await fetch(`${base}/api/task/backup-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(backupPrepare.status, 200)
    const backupToken = (await backupPrepare.json()).data.token
    const backupResponse = await fetch(
      `${base}/api/task/download/${backupToken}`,
    )
    let backupBytes = 0
    for await (const chunk of backupResponse.body!) backupBytes += chunk.length
    assert.ok(
      backupBytes > 512 * 1024 * 1024,
      'Streaming backup exceeds the old in-memory cap',
    )
    assert.equal(
      backupBytes,
      Number(backupResponse.headers.get('Content-Length')),
    )
    assert.equal(getTaskDownloadStatus(backupToken)?.state, 'completed')
    for (let index = 0; index < 9; index++)
      await fs.unlink(path.join(imageRoot, `backup-large-${index}.png`))
    await fs.unlink(path.join(imageRoot, '0.png'))
    const missing = await prepare([tasks[0].id])
    assert.equal(missing.response.status, 400)
    assert.match(missing.result.error, /图片文件读取失败/)

    // A file disappearing after preflight must abort, not silently produce a ZIP.
    const stale = await prepare([tasks[1].id])
    await fs.unlink(path.join(imageRoot, '1.png'))
    const staleResponse = streamTaskDownload(stale.result.data.token)!
    await assert.rejects(staleResponse.arrayBuffer())
    assert.equal(
      getTaskDownloadStatus(stale.result.data.token)?.state,
      'failed',
    )

    // Slow consumers must not cause the whole archive to be buffered. Cancel a
    // theoretical multi-GiB ZIP after its first bytes, using one 8 MiB source.
    const largePath = path.join(imageRoot, 'large.png')
    await fs.writeFile(largePath, Buffer.alloc(8 * 1024 * 1024, 7))
    // No consumer: the Web-stream adapter must backpressure the ZIP producer
    // instead of treating its byte high-water mark as a number of chunks.
    const stalled = createZipDownloadSession(
      Array.from({ length: 8 }, (_, index) => ({
        filePath: largePath,
        archivePath: `stalled-${index}.png`,
        size: 8 * 1024 * 1024,
        mtime: new Date(),
      })),
      'stalled',
    )
    // Older Node adapters use a chunk-count queue unless a size strategy is
    // supplied. Reproduce that fallback even on newer development runtimes.
    const nativeToWeb = Readable.toWeb
    Readable.toWeb = (stream, options) =>
      nativeToWeb(
        stream,
        options ?? {
          strategy: { highWaterMark: stream.readableHighWaterMark },
        },
      )
    const stalledResponse = streamTaskDownload(stalled.token)!
    Readable.toWeb = nativeToWeb
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      assert.equal(getTaskDownloadStatus(stalled.token)?.state, 'running')
      assert.equal(
        getTaskDownloadStatus(stalled.token)?.completedFiles,
        0,
        'A stalled consumer must not read even one complete 8 MiB file ahead',
      )
    } finally {
      await stalledResponse.body!.cancel()
    }
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(getTaskDownloadStatus(stalled.token)?.state, 'failed')
    // A replacement request must stop the older producer, and HEAD must not
    // consume the token or interrupt an in-progress GET.
    const interrupted = streamTaskDownload(stalled.token)!
    const runningHead = await fetch(
      `${base}/api/task/download/${stalled.token}`,
      { method: 'HEAD' },
    )
    assert.equal(runningHead.status, 200)
    assert.equal(getTaskDownloadStatus(stalled.token)?.state, 'running')
    const restarted = await fetch(`${base}/api/task/download/${stalled.token}`)
    await assert.rejects(interrupted.arrayBuffer())
    let restartedBytes = 0
    for await (const chunk of restarted.body!) restartedBytes += chunk.length
    assert.equal(
      restartedBytes,
      Number(restarted.headers.get('Content-Length')),
    )
    assert.equal(getTaskDownloadStatus(stalled.token)?.state, 'completed')
    assert.equal(getTaskDownloadStatus(stalled.token)?.completedFiles, 8)
    const large = createZipDownloadSession(
      Array.from({ length: 600 }, (_, index) => ({
        filePath: largePath,
        archivePath: `${index}.png`,
        size: 8 * 1024 * 1024,
        mtime: new Date(),
      })),
      'cancel',
    )
    const controller = new AbortController()
    const largeResponse = await fetch(
      `${base}/api/task/download/${large.token}`,
      { signal: controller.signal },
    )
    assert.ok(
      Number(largeResponse.headers.get('Content-Length')) >
        4 * 1024 * 1024 * 1024,
      'ZIP64 size calculation supports multi-GiB exports',
    )
    assert.ok((await largeResponse.body!.getReader().read()).value!.length > 0)
    controller.abort()
    for (
      let attempt = 0;
      attempt < 50 && getTaskDownloadStatus(large.token)?.state === 'running';
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(getTaskDownloadStatus(large.token)?.state, 'failed')
    assert.ok(getTaskDownloadStatus(large.token)!.completedFiles < 600)
    await fs.unlink(largePath)
    console.log(
      'Streaming ZIP: HTTP 420-image integrity, 576 MiB backup, folders, Content-Length, HEAD/retry/restart, legacy Node backpressure, missing files, ZIP64 sizing and cancellation passed',
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    if (previous === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previous
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('linai-stream-download-'))
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
