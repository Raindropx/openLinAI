import JSZip from 'jszip'
import assert from 'node:assert/strict'
import {
  createFilesZip,
  createFilesZipParts,
  DOWNLOAD_CONCURRENCY,
  downloadFilesZip,
  type DownloadFileInfo,
  type DownloadProgress,
} from '../src/client/utils/download'

const originalFetch = globalThis.fetch
const files: DownloadFileInfo[] = Array.from({ length: 420 }, (_, index) => ({
  url: `/fixture/${index}.png?version=1`,
  fileName: '同名图片',
  id: String(index),
  createdAt: 1,
  endpointName: 'fixture',
  folder: index % 2 ? '文件夹' : undefined,
}))

async function main() {
  let active = 0
  let peak = 0
  let requests = 0
  class DelayedResponse extends Response {
    async arrayBuffer() {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return await super.arrayBuffer()
      } finally {
        active--
      }
    }
  }
  globalThis.fetch = (async (input) => {
    active++
    requests++
    peak = Math.max(peak, active)
    const index = Number(String(input).match(/\/(\d+)\.png/)?.[1])
    return new DelayedResponse(new Uint8Array([index % 256, 2, 3]))
  }) as typeof fetch
  const progress: DownloadProgress[] = []
  const exported = new Set<string>()
  const counts: number[] = []
  let folderCount = 0
  for await (const { content, part, isLast } of createFilesZipParts(files, {
    onProgress: (item) => progress.push(item),
  })) {
    assert.equal(part, counts.length + 1)
    assert.equal(isLast, part === 5)
    const zip = await JSZip.loadAsync(await content.arrayBuffer(), {
      checkCRC32: true,
    })
    const entries = Object.values(zip.files).filter((entry) => !entry.dir)
    counts.push(entries.length)
    for (const entry of entries) {
      assert.ok(entry.name.endsWith('.png'), 'Query strings are not extensions')
      assert.ok(!exported.has(entry.name), 'Names stay unique across ZIP parts')
      exported.add(entry.name)
      if (entry.name.startsWith('文件夹/')) folderCount++
      assert.equal((await entry.async('uint8array')).length, 3)
    }
  }
  assert.deepEqual(counts, [100, 100, 100, 100, 20])
  assert.equal(exported.size, 420)
  assert.equal(folderCount, 210)
  assert.equal(requests, 420, 'No duplicate requests or automatic retries')
  assert.equal(active, 0)
  assert.equal(peak, DOWNLOAD_CONCURRENCY)
  assert.equal(progress.at(-1)?.completed, 420)
  assert.equal(progress.at(-1)?.total, 420)

  const sizes: number[] = []
  for await (const { content } of createFilesZipParts(files.slice(0, 7), {
    maxBytes: 7,
  })) {
    const zip = await JSZip.loadAsync(await content.arrayBuffer())
    sizes.push(Object.values(zip.files).filter((entry) => !entry.dir).length)
  }
  assert.deepEqual(sizes, [2, 2, 2, 1], 'Byte size also triggers splitting')
  const singleZip = await JSZip.loadAsync(
    await (await createFilesZip(files.slice(0, 3))).arrayBuffer(),
  )
  assert.equal(
    Object.values(singleZip.files).filter((entry) => !entry.dir).length,
    3,
  )

  let requested: string[] = []
  let aborted = 0
  globalThis.fetch = ((input, init) => {
    const url = String(input)
    requested.push(url)
    if (url === files[0].url)
      return Promise.resolve(new Response('', { status: 404 }))
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          aborted++
          reject(new Error('aborted'))
        },
        { once: true },
      )
    })
  }) as typeof fetch
  await assert.rejects(createFilesZip(files), /读取图片失败：.*HTTP 404/)
  assert.equal(requested.length, 4, 'Failure stops queued requests')
  assert.equal(aborted, 3, 'Failure cancels in-flight requests')

  requested = []
  globalThis.fetch = (async (input) => {
    const url = String(input)
    requested.push(url)
    return url === files[108].url
      ? new Response('', { status: 500 })
      : new Response(new Uint8Array([1]))
  }) as typeof fetch
  // FileSaver is a no-op in Node; assert the partial-download diagnostic here.
  await assert.rejects(
    downloadFilesZip(files, 'fixture'),
    /已发起 1 个分包下载，其余未完成.*HTTP 500/,
  )
  assert.equal(
    requested.length,
    112,
    'No later batches run after a partial failure',
  )
  console.log(
    'Bulk download: 420 images, concurrency, count/byte splitting, ZIP integrity, paths, progress and failures passed',
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    globalThis.fetch = originalFetch
  })
