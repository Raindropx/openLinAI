import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import sharp from 'sharp'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-upstream-ports-'))
  const originalFetch = globalThis.fetch
  process.env.DATA_DIR = root
  try {
    const { taskManager } = await import('../src/server/common/task-manager')
    const { templateManager } = await import('../src/server/common/template-manager')
    const { default: tasksApi } = await import('../src/server/api/common/task')
    const { getPendingImages, changePendingImages } = await import('../src/server/common/pending-images')
    const { getGalleryReferences, deleteUnreferencedImages, GENERATED_IMAGES_DIR, INPUT_IMAGES_DIR } = await import('../src/server/common/static')
    const { withImageGeneration, writeGenerationImage, generationFetch } = await import('../src/server/common/image-lifecycle')
    const template = { id: 'fixture', prompt: 'fixture', images: [], usageType: 'image' as const, createdAt: 1 }
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#4382b0' } }).png().toBuffer()
    const input = '/api/static/images/input/ref.png'
    await fs.writeFile(path.join(INPUT_IMAGES_DIR, 'ref.png'), png)

    await Promise.all([changePendingImages('add', [input]), changePendingImages('add', [input])])
    assert.deepEqual(await getPendingImages(), [input], 'Concurrent devices deduplicate additions')
    assert.deepEqual(await deleteUnreferencedImages({ type: 'input', urls: [input] }), { deletedCount: 0, skippedCount: 1 }, 'Pending reference survives cleanup')
    await templateManager.addTemplate({ ...template, images: [input] })
    await changePendingImages('remove', [input])
    assert.equal((await deleteUnreferencedImages({ type: 'input', urls: [input] })).skippedCount, 1, 'Removing pending intent preserves template references')
    assert.ok((await getGalleryReferences()).templateUrls.includes(input))
    const input2 = '/api/static/images/input/ref2.png'
    await fs.writeFile(path.join(INPUT_IMAGES_DIR, 'ref2.png'), png)
    await Promise.all([changePendingImages('add', [input]), changePendingImages('add', [input2])])
    assert.equal((await getPendingImages()).length, 2, 'Disjoint additions are not lost')
    await assert.rejects(changePendingImages('add', [input, '/api/static/images/input/../escape.png']))
    assert.equal((await getPendingImages()).length, 2, 'Invalid batch leaves pending list intact')
    await templateManager.addTemplate({ ...template, id: 'legacy', images: ['/api/static/input/ref2.png'] })
    await changePendingImages('remove', [input2])
    assert.equal((await deleteUnreferencedImages({ type: 'input', urls: [input2] })).skippedCount, 1, 'Legacy references remain protected')
    const sourceUrl = '/api/static/images/generated/pending-source.png'
    await fs.writeFile(path.join(GENERATED_IMAGES_DIR, 'pending-source.png'), png)
    await changePendingImages('add', [sourceUrl])
    const copied = (await getPendingImages()).find((url) => url !== input)!
    assert.match(copied, /^\/api\/static\/images\/input\//, 'Pending generated image becomes an input reference')
    assert.equal((await deleteUnreferencedImages({ type: 'input', urls: [copied] })).skippedCount, 1)

    const sharedUrl = '/api/static/images/generated/shared.png'
    await fs.writeFile(path.join(GENERATED_IMAGES_DIR, 'shared.png'), png)
    const first = await taskManager.createTaskFromTemplate({ template, source: 'fixture' })
    const second = await taskManager.createTaskFromTemplate({ template, source: 'fixture' })
    await taskManager.updateTask(first.id, { status: 'completed', outputUrls: [sharedUrl] })
    await taskManager.updateTask(second.id, { status: 'completed', outputUrls: [sharedUrl] })
    await taskManager.deleteTask(first.id)
    assert.ok(await fs.pathExists(path.join(GENERATED_IMAGES_DIR, 'shared.png')), 'Other task reference protects deduplicated output')
    await taskManager.deleteTask(second.id)
    assert.equal(await fs.pathExists(path.join(GENERATED_IMAGES_DIR, 'shared.png')), false, 'Last reference releases output')

    let ready!: () => void
    const registered = new Promise<void>((resolve) => { ready = resolve })
    let runningId = ''
    globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) reject(new DOMException('Cancelled', 'AbortError'))
      else signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
    })
    const run = withImageGeneration(async () => {
      const task = await taskManager.createTaskFromTemplate({ template, source: 'fixture' })
      runningId = task.id
      await writeGenerationImage('cancelled.png', png)
      ready()
      await assert.rejects(generationFetch('https://fixture.invalid/generate'), /Cancelled|abort/i)
      await assert.rejects(taskManager.updateTask(task.id, { status: 'completed', outputUrls: ['/api/static/images/generated/cancelled.png'] }))
    })
    await registered
    assert.equal((await deleteUnreferencedImages({ type: 'generated', urls: ['/api/static/images/generated/cancelled.png'] })).skippedCount, 1, 'Uncommitted generation is pinned')
    await taskManager.deleteTask(runningId)
    await run
    assert.equal(await fs.pathExists(path.join(GENERATED_IMAGES_DIR, 'cancelled.png')), false, 'Deletion waits for cancellation and removes uncommitted output')
    assert.equal((await taskManager.getTasks()).some((task) => task.id === runningId), false)
    globalThis.fetch = originalFetch

    await withImageGeneration(async () => {
      await writeGenerationImage('failed.png', png)
    })
    assert.equal(await fs.pathExists(path.join(GENERATED_IMAGES_DIR, 'failed.png')), false, 'Unbound output is cleaned')
    await withImageGeneration(async () => {
      const task = await taskManager.createTaskFromTemplate({ template, source: 'fixture' })
      await writeGenerationImage('completed.png', png)
      await taskManager.updateTask(task.id, { status: 'completed', outputUrls: ['/api/static/images/generated/completed.png'] })
    })
    assert.ok(await fs.pathExists(path.join(GENERATED_IMAGES_DIR, 'completed.png')), 'Committed output survives generation cleanup')

    let release!: () => void
    const overlap = new Promise<void>((resolve) => { release = resolve })
    let pinned!: () => void
    const pinsReady = new Promise<void>((resolve) => { pinned = resolve })
    // Start independent roots, then release the first before the last owner.
    const creator = withImageGeneration(async () => {
      await writeGenerationImage('overlap.png', png)
      pinned()
      await overlap
    })
    await pinsReady
    let secondReady!: () => void
    const secondPinned = new Promise<void>((resolve) => { secondReady = resolve })
    let releaseSecond!: () => void
    const secondWait = new Promise<void>((resolve) => { releaseSecond = resolve })
    const sameOutput = withImageGeneration(async () => {
      await writeGenerationImage('overlap.png', png)
      secondReady()
      await secondWait
    })
    await secondPinned
    release()
    await creator
    assert.ok(await fs.pathExists(path.join(GENERATED_IMAGES_DIR, 'overlap.png')), 'Last active owner protects identical output')
    releaseSecond()
    await sameOutput
    assert.equal(await fs.pathExists(path.join(GENERATED_IMAGES_DIR, 'overlap.png')), false, 'Last owner cleans newly created unbound output')

    const folder = await taskManager.saveFolder('Fixture folder')
    const records = Array.from({ length: 220 }, (_, i) => ({
      id: `history-${i}`, createdAt: i + 1, source: 'fixture', status: 'completed' as const,
      folderId: i % 2 ? folder.id : undefined, outputUrls: [],
      rawTemplate: { ...template, title: `Title ${i}`, prompt: i === 100 ? 'needle' : 'fixture', images: [input], privateSnapshot: 'x'.repeat(10000) },
      novelaiSnapshots: [{ request: { prompt: 'large snapshot', characters: ['x'.repeat(10000)] } }],
    }))
    await taskManager.restoreTasks(records as any, [])
    const catalogResponse = await tasksApi.request('/catalog')
    const catalog = (await catalogResponse.json()).data
    assert.ok(catalog.tasks.every((task: any) => task.summaryOnly && !task.novelaiSnapshots && !task.rawTemplate.images.length && !task.rawTemplate.privateSnapshot))
    const full = await taskManager.getTasks()
    assert.ok(JSON.stringify(catalog).length < JSON.stringify(full).length / 10, 'Catalog omits large historical snapshots')
    const pageResponse = await tasksApi.request('/page?page=0&pageSize=12&folderId=' + folder.id + '&sort=time-asc')
    const page = (await pageResponse.json()).data
    assert.equal(page.items.length, 12)
    assert.equal(page.total, 110)
    assert.equal(page.items[0].id, 'history-1')
    assert.ok(page.items[0].rawTemplate.privateSnapshot, 'Page returns the complete editable snapshot')
    const search = (await (await tasksApi.request('/page?search=needle')).json()).data
    assert.deepEqual(search.items.map((task: any) => task.id), ['history-100'])
    const specific = (await (await tasksApi.request('/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['history-5', 'history-1'], page: 0, pageSize: 1 }) })).json()).data
    assert.equal(specific.items[0].id, 'history-5')
    assert.equal(specific.total, 2)
    await taskManager.deleteTask('history-5', true)
    const refreshed = (await (await tasksApi.request('/catalog')).json()).data
    assert.notEqual(refreshed.revision, catalog.revision)
    assert.ok(!refreshed.tasks.some((task: any) => task.id === 'history-5'))
    const changedExternally = await taskManager.getTasks()
    changedExternally[0].rawTemplate.title = 'External fixture edit'
    await fs.writeJson(path.join(root, 'tasks.json'), changedExternally)
    const external = (await (await tasksApi.request('/catalog')).json()).data
    assert.notEqual(external.revision, refreshed.revision, 'External changes invalidate cached catalog')
    assert.equal(external.tasks.find((task: any) => task.id === changedExternally[0].id).rawTemplate.title, 'External fixture edit')
    console.log('upstream ports: pending concurrency/protection, cancellation/cleanup, shared outputs, catalog size, pages/search/folders/revisions passed')
  } finally {
    globalThis.fetch = originalFetch
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('linai-upstream-ports-'))
    await fs.remove(root)
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
