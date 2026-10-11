import fse from 'fs-extra'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { imageThumbnailUrl } from '../src/client/utils/imageUrls'

async function main() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'linai-thumbnail-rebuild-'),
  )
  process.env.DATA_DIR = root
  process.env.IMAGE_BACKEND = process.argv.includes('--ffmpeg')
    ? 'ffmpeg'
    : 'sharp'
  const originalRename = fse.rename
  let release = () => {}
  let waitForCompletion: (() => Promise<void>) | undefined
  try {
    const api = (await import('../src/server/api/common/static')).default
    const { cleanupThumbnailCache, deleteImageFile, getThumbnailCacheStatus } =
      await import('../src/server/common/static')
    const { getImageOutputExtension } =
      await import('../src/server/common/static/imageProcessor')
    const generated = path.join(root, 'images', 'generated')
    const input = path.join(root, 'images', 'input')
    const thumbs = path.join(root, 'images', 'thumb', 'generated')
    const inputThumbs = path.join(root, 'images', 'thumb', 'input')
    await fs.mkdir(thumbs, { recursive: true })
    await fs.mkdir(inputThumbs, { recursive: true })
    const image = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer()
    await fs.writeFile(path.join(generated, 'first.png'), image)
    await fs.writeFile(path.join(generated, 'corrupt.png'), 'invalid image')
    await fs.writeFile(path.join(input, 'reference.png'), image)
    await fs.writeFile(path.join(input, 'gone.png'), image)
    await fs.writeFile(path.join(root, 'tasks.json'), '[{"id":"preserve-me"}]')
    await fs.writeFile(path.join(root, 'config.json'), '{"preserve":true}')
    await fs.writeFile(path.join(thumbs, 'first.jpg'), 'stale')
    await fs.writeFile(path.join(thumbs, 'first.webp'), 'stale')
    await fs.writeFile(path.join(thumbs, 'orphan.jpg'), 'orphan')
    await fs.writeFile(
      path.join(thumbs, 'old.jpg.12345678-1234-1234-1234-123456789abc.jpg'),
      'temporary',
    )
    await fs.writeFile(path.join(inputThumbs, 'reference.webp'), 'stale')
    await fs.writeFile(
      path.join(thumbs, 'notes.txt'),
      'leave unrelated files alone',
    )
    await fs.mkdir(path.join(thumbs, 'directory.jpg'))
    const preserved = [
      path.join(generated, 'first.png'),
      path.join(generated, 'corrupt.png'),
      path.join(input, 'reference.png'),
      path.join(root, 'tasks.json'),
      path.join(root, 'config.json'),
    ]
    const hashes = async () =>
      Promise.all(
        preserved.map(async (file) =>
          crypto
            .createHash('sha256')
            .update(await fs.readFile(file))
            .digest('hex'),
        ),
      )
    const before = await hashes()
    const initial = await api.request('/images/thumbnail-cache')
    assert.equal(initial.headers.get('cache-control'), 'no-store')
    assert.equal((await initial.json()).data.state, 'idle')

    let reached!: () => void
    const publishing = new Promise<void>((resolve) => {
      reached = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let activeTemporary = ''
    let firstPublishes = 0
    fse.rename = (async (from: string, to: string) => {
      if (path.basename(to).startsWith('first.')) {
        firstPublishes++
        activeTemporary = from
        reached()
        await gate
      }
      return originalRename(from, to)
    }) as typeof fse.rename
    waitForCompletion = async () => {
      const deadline = Date.now() + 15000
      while (getThumbnailCacheStatus().state === 'running') {
        assert.ok(Date.now() < deadline, 'background rebuild must finish')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    const started = await api.request('/images/thumbnail-cache/rebuild', {
      method: 'POST',
    })
    assert.equal(started.status, 202)
    const job = (await started.json()).data
    assert.equal(job.state, 'running')
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        publishing,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('encoder did not reach publish')),
            10000,
          )
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
    const duplicate = await api.request('/images/thumbnail-cache/rebuild', {
      method: 'POST',
    })
    assert.equal(
      (await duplicate.json()).data.id,
      job.id,
      'duplicate requests join the running job',
    )
    const progress = (
      await (await api.request('/images/thumbnail-cache')).json()
    ).data
    assert.equal(
      progress.id,
      job.id,
      'a reopened settings window can recover progress',
    )
    assert.equal(progress.total, 4)
    assert.equal(progress.phase, 'rebuilding')
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await fs.utimes(activeTemporary, old, old)
    await cleanupThumbnailCache()
    assert.ok(
      await fs.stat(activeTemporary),
      'periodic cleanup must preserve the active encoder',
    )
    await deleteImageFile('input', 'gone.png')
    release()
    await waitForCompletion()
    const finished = getThumbnailCacheStatus()
    assert.equal(finished.state, 'completed')
    assert.equal(finished.processed, 4)
    assert.equal(finished.regenerated, 2)
    assert.equal(
      finished.failed,
      1,
      'a corrupt image does not stop the rest of the library',
    )
    assert.equal(finished.skipped, 1, 'a deleted source is skipped')
    assert.equal(finished.removed, 5)
    assert.equal(
      firstPublishes,
      1,
      'duplicate requests do not restart encoders',
    )
    assert.deepEqual(
      await hashes(),
      before,
      'originals, task records and settings must remain byte-identical',
    )
    const extension = getImageOutputExtension()
    for (const file of [
      path.join(thumbs, `first${extension}`),
      path.join(inputThumbs, `reference${extension}`),
    ]) {
      const metadata = await sharp(await fs.readFile(file)).metadata()
      assert.equal(Math.min(metadata.width!, metadata.height!), 200)
    }
    assert.deepEqual(
      (await fs.readdir(thumbs)).sort(),
      ['directory.jpg', `first${extension}`, 'notes.txt'].sort(),
    )
    assert.deepEqual(await fs.readdir(inputThumbs), [`reference${extension}`])

    // Fail before clearing anything when either source directory is unavailable.
    fse.rename = originalRename
    await fs.rename(input, `${input}-offline`)
    await fs.writeFile(path.join(thumbs, 'outage.jpg'), 'preserve-cache')
    const log = console.error
    let loggedFailure = false
    console.error = () => {
      loggedFailure = true
    }
    try {
      const restart = await api.request('/images/thumbnail-cache/rebuild', {
        method: 'POST',
      })
      assert.notEqual((await restart.json()).data.id, job.id)
      await waitForCompletion()
    } finally {
      console.error = log
    }
    assert.equal(getThumbnailCacheStatus().state, 'failed')
    assert.ok(loggedFailure)
    assert.equal(
      await fs.readFile(path.join(thumbs, 'outage.jpg'), 'utf8'),
      'preserve-cache',
    )
    await fs.rename(`${input}-offline`, input)
    assert.deepEqual(await hashes(), before)

    assert.equal(
      imageThumbnailUrl('/api/static/images/input/reference.png', job.id),
      `/api/static/images/input/reference.png?thumb=true&cacheVersion=${job.id}`,
    )
    assert.equal(
      imageThumbnailUrl('https://example.com/image.png', job.id),
      'https://example.com/image.png',
    )
    const revised = imageThumbnailUrl(
      '/api/static/images/generated/first.png?thumb=true&cacheVersion=old',
      job.id,
    )
    assert.ok(
      revised.includes(`cacheVersion=${job.id}`) && !revised.includes('old'),
    )
    console.log(
      `${process.env.IMAGE_BACKEND}: background API, duplicate requests, progress recovery, cache clearing, sequential regeneration, corrupt/deleted sources, original integrity, source outage and browser cache version passed`,
    )
  } finally {
    release()
    await waitForCompletion?.()
    fse.rename = originalRename
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('linai-thumbnail-rebuild-'))
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
