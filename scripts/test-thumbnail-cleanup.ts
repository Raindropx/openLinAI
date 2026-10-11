import fse from 'fs-extra'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

async function main() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'linai-thumbnail-cleanup-'),
  )
  process.env.DATA_DIR = root
  process.env.IMAGE_BACKEND = process.argv.includes('--ffmpeg')
    ? 'ffmpeg'
    : 'sharp'
  const originalRename = fse.rename
  try {
    const {
      cleanupThumbnailCache,
      deleteImageFile,
      serveImage,
      startThumbnailCacheMaintenance,
    } = await import('../src/server/common/static')
    const { taskManager } = await import('../src/server/common/task-manager')
    const generated = path.join(root, 'images', 'generated')
    const thumbs = path.join(root, 'images', 'thumb', 'generated')
    const input = path.join(root, 'images', 'input')
    const inputThumbs = path.join(root, 'images', 'thumb', 'input')
    await fs.mkdir(thumbs, { recursive: true })
    await fs.mkdir(inputThumbs, { recursive: true })
    const image = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer()
    const exists = (name: string) =>
      fs.stat(name).then(
        () => true,
        (error) => {
          if (error.code === 'ENOENT') return false
          throw error
        },
      )
    const fixture = async (name: string) => {
      await fs.writeFile(path.join(generated, `${name}.png`), image)
      for (const extension of ['jpg', 'webp'])
        await fs.writeFile(path.join(thumbs, `${name}.${extension}`), 'cache')
      return `/api/static/images/generated/${name}.png`
    }
    const template = {
      id: 'fixture',
      prompt: 'fixture',
      images: [],
      usageType: 'image' as const,
      createdAt: 1,
    }
    const addTask = async (id: string, outputUrls: string[]) =>
      taskManager.addCompletedTask({
        id,
        rawTemplate: template,
        status: 'completed',
        source: 'fixture',
        createdAt: 1,
        outputUrls,
      })

    await addTask('delete', [await fixture('delete')])
    assert.equal((await taskManager.deleteTask('delete')).success, true)
    for (const filename of ['delete.jpg', 'delete.webp'])
      assert.equal(await exists(path.join(thumbs, filename)), false)
    assert.equal(await exists(path.join(generated, 'delete.png')), false)
    await addTask('keep', [await fixture('keep')])
    await taskManager.deleteTask('keep', true)
    assert.ok(await exists(path.join(generated, 'keep.png')))
    assert.ok(await exists(path.join(thumbs, 'keep.jpg')))

    await addTask('batch-first', [await fixture('batch-first')])
    await addTask('batch-second', [await fixture('batch-second')])
    const beforeInvalidBatch = await fs.readFile(path.join(root, 'tasks.json'))
    await assert.rejects(
      taskManager.deleteTasks(['batch-first', 'missing']),
      /任务不存在/,
    )
    assert.deepEqual(
      await fs.readFile(path.join(root, 'tasks.json')),
      beforeInvalidBatch,
    )
    let notifications = 0
    const onTasksUpdated = () => {
      notifications++
    }
    taskManager.on('tasks-updated', onTasksUpdated)
    assert.equal(
      await taskManager.deleteTasks([
        'batch-first',
        'batch-second',
        'batch-first',
      ]),
      2,
    )
    taskManager.off('tasks-updated', onTasksUpdated)
    assert.equal(notifications, 1)
    for (const name of ['batch-first', 'batch-second']) {
      assert.equal(await exists(path.join(generated, `${name}.png`)), false)
      assert.equal(await exists(path.join(thumbs, `${name}.jpg`)), false)
    }
    await addTask('batch-keep', [await fixture('batch-keep')])
    assert.equal(await taskManager.deleteTasks(['batch-keep'], true), 1)
    assert.ok(await exists(path.join(generated, 'batch-keep.png')))

    await addTask('multi', [await fixture('first'), await fixture('second')])
    assert.equal((await taskManager.deleteTaskImage('multi', 0)).success, true)
    assert.equal(await exists(path.join(thumbs, 'first.webp')), false)
    assert.ok(await exists(path.join(thumbs, 'second.webp')))
    assert.equal(
      (await taskManager.getTasks()).find((task) => task.id === 'multi')
        ?.outputUrls?.length,
      1,
    )
    await fs.writeFile(path.join(thumbs, 'missing-source.jpg'), 'cache')
    await deleteImageFile('generated', 'missing-source.png')
    assert.equal(await exists(path.join(thumbs, 'missing-source.jpg')), false)
    await assert.rejects(
      deleteImageFile('generated', '../tasks.json'),
      /Invalid/,
    )

    await fs.writeFile(path.join(input, 'reference.png'), image)
    await fs.writeFile(path.join(inputThumbs, 'reference.jpg'), 'keep')
    await fs.writeFile(path.join(inputThumbs, 'orphan.webp'), 'remove')
    await fs.writeFile(path.join(thumbs, 'orphan.jpg'), 'remove')
    await fs.writeFile(path.join(thumbs, 'orphan.webp'), 'remove')
    await fs.writeFile(path.join(thumbs, 'notes.txt'), 'unrelated')
    await fs.mkdir(path.join(thumbs, 'directory.jpg'))
    const suffix = '.00000000-0000-0000-0000-000000000000.jpg'
    const oldTemporary = path.join(thumbs, `keep.jpg${suffix}`)
    const freshTemporary = path.join(thumbs, `fresh.jpg${suffix}`)
    await fs.writeFile(oldTemporary, 'stale partial image')
    await fs.writeFile(freshTemporary, 'recent partial image')
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await fs.utimes(oldTemporary, oldTime, oldTime)
    const tasksBefore = await fs.readFile(path.join(root, 'tasks.json'))
    const sweep = cleanupThumbnailCache()
    assert.equal(
      cleanupThumbnailCache(),
      sweep,
      'concurrent maintenance shares a sweep',
    )
    assert.equal((await sweep).removed, 4)
    for (const filename of [
      'keep.jpg',
      'keep.webp',
      'second.jpg',
      'second.webp',
      'notes.txt',
      'directory.jpg',
    ])
      assert.ok(await exists(path.join(thumbs, filename)), filename)
    assert.ok(await exists(freshTemporary))
    assert.equal(await exists(oldTemporary), false)
    assert.ok(await exists(path.join(inputThumbs, 'reference.jpg')))
    assert.deepEqual(
      await fs.readFile(path.join(root, 'tasks.json')),
      tasksBefore,
    )
    assert.deepEqual(
      await fs.readFile(path.join(input, 'reference.png')),
      image,
    )
    assert.deepEqual(await fs.readFile(path.join(generated, 'keep.png')), image)

    // Missing source storage must never be interpreted as an empty image library.
    await fs.writeFile(path.join(thumbs, 'outage.jpg'), 'preserve')
    await fs.rename(generated, `${generated}-offline`)
    await assert.rejects(cleanupThumbnailCache(), /ENOENT/)
    assert.ok(await exists(path.join(thumbs, 'outage.jpg')))
    await fs.rename(`${generated}-offline`, generated)

    // Pause immediately before publishing a real encoded thumbnail. Maintenance
    // must skip it, and task deletion must wait then remove the published file.
    let reached!: () => void
    let release!: () => void
    const publishing = new Promise<void>((resolve) => {
      reached = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let activeTemporary = ''
    fse.rename = (async (from: string, to: string) => {
      if (path.basename(to).startsWith('race.')) {
        activeTemporary = from
        reached()
        await gate
      }
      return originalRename(from, to)
    }) as typeof fse.rename
    await fs.writeFile(path.join(generated, 'race.png'), image)
    await addTask('race', ['/api/static/images/generated/race.png'])
    const request = serveImage({
      type: 'generated',
      filename: 'race.png',
      thumb: true,
    }).then(async (response) => response?.arrayBuffer())
    await publishing
    await fs.utimes(activeTemporary, oldTime, oldTime)
    await cleanupThumbnailCache()
    assert.ok(
      await exists(activeTemporary),
      'active encoding is never swept, even with old mtime',
    )
    const deletion = taskManager.deleteTask('race')
    release()
    await Promise.all([request, deletion])
    assert.equal(await exists(path.join(generated, 'race.png')), false)
    assert.ok(
      (await fs.readdir(thumbs)).every((name) => !name.startsWith('race.')),
    )
    assert.equal(
      await serveImage({
        type: 'generated',
        filename: 'race.png',
        thumb: true,
      }),
      null,
    )
    fse.rename = originalRename

    const setTimeoutBefore = globalThis.setTimeout
    const scheduled: {
      callback: () => Promise<void>
      delay: number
      unref: boolean
    }[] = []
    globalThis.setTimeout = ((callback: () => Promise<void>, delay: number) => {
      const timer = { callback, delay, unref: false }
      scheduled.push(timer)
      return {
        unref: () => {
          timer.unref = true
        },
      }
    }) as unknown as typeof setTimeout
    try {
      startThumbnailCacheMaintenance()
      startThumbnailCacheMaintenance()
      assert.equal(scheduled.length, 1)
      assert.equal(scheduled[0].delay, 60_000)
      assert.ok(scheduled[0].unref)
      await scheduled[0].callback()
      assert.equal(scheduled[1].delay, 6 * 60 * 60 * 1000)
      assert.ok(scheduled[1].unref)
    } finally {
      globalThis.setTimeout = setTimeoutBefore
    }
    console.log(
      `${process.env.IMAGE_BACKEND}: task/batch/single-image deletion, keep-image, both cache formats, orphan/temporary cleanup, source outage, active generation race, task/source integrity and maintenance scheduling passed`,
    )
  } finally {
    fse.rename = originalRename
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('linai-thumbnail-cleanup-'))
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
