import JSZip from 'jszip'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-task-folders-'))
  const previousDataDir = process.env.DATA_DIR
  const previousFetch = globalThis.fetch
  process.env.DATA_DIR = root
  try {
    const { taskManager, TaskManager } =
      await import('../src/server/common/task-manager')
    const { default: api } = await import('../src/server/api/common/task')
    const { taskFolderNameSchema } = await import('../src/shared/task-folders')
    const template = {
      id: 'template',
      title: 'same',
      prompt: 'test',
      images: [],
      usageType: 'image' as const,
      createdAt: 1,
    }
    const first = await taskManager.createTaskFromTemplate({
      template,
      source: 'fixture',
    })
    const second = await taskManager.createTaskFromTemplate({
      template,
      source: 'fixture',
    })
    assert.equal(
      first.folderId,
      undefined,
      'Legacy/new unassigned tasks belong to root',
    )
    const create = await api.request('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '作品' }),
    })
    assert.equal(create.status, 200)
    const folder = (await create.json()).data
    assert.equal(
      (await new TaskManager().getFolders())[0].name,
      '作品',
      'Empty folders survive restart',
    )
    for (const name of [
      '..',
      '.',
      '../escape',
      'a/b',
      'a\\b',
      'bad.',
      'CON',
      'nul.png',
      'a\u0000b',
    ])
      assert.equal(taskFolderNameSchema.safeParse(name).success, false, name)
    await assert.rejects(taskManager.saveFolder('作品'), /文件夹已存在/)
    const createdInside = await taskManager.createTaskFromTemplate({
      template,
      source: 'fixture',
      folderId: folder.id,
    })
    assert.equal(
      createdInside.folderId,
      folder.id,
      'Generation records selected folder',
    )
    const move = await api.request('/move', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [first.id, second.id], folderId: folder.id }),
    })
    assert.equal((await move.json()).count, 2)
    await taskManager.saveFolder('改名', folder.id)
    assert.equal(
      (await taskManager.getTasks()).find((task) => task.id === first.id)
        ?.folderId,
      folder.id,
      'Renaming keeps stable membership',
    )
    assert.equal((await new TaskManager().getFolders())[0].name, '改名')
    await assert.rejects(
      taskManager.moveTasks([first.id, 'missing'], ''),
      /任务不存在/,
    )
    assert.equal(
      (await taskManager.getTasks()).find((task) => task.id === first.id)
        ?.folderId,
      folder.id,
      'Failed batches do not partially move',
    )
    await assert.rejects(
      taskManager.moveTasks([first.id], 'missing'),
      /文件夹不存在/,
    )
    await taskManager.moveTasks([first.id], '')
    assert.equal(
      (await taskManager.getTasks()).find((task) => task.id === first.id)
        ?.folderId,
      undefined,
      'Dragging out restores root',
    )
    const image = path.join(root, 'kept.png')
    await fs.writeFile(image, 'preserve image')
    await taskManager.updateTask(second.id, {
      status: 'completed',
      outputUrls: ['/fixture.png'],
    })
    await taskManager.deleteFolder(folder.id)
    assert.equal((await taskManager.getTasks()).length, 3)
    assert.ok((await taskManager.getTasks()).every((task) => !task.folderId))
    assert.equal(await fs.readFile(image, 'utf8'), 'preserve image')
    assert.equal((await taskManager.getFolders()).length, 0)
    await assert.rejects(
      taskManager.createTaskFromTemplate({
        template,
        source: 'fixture',
        folderId: folder.id,
      }),
      /文件夹不存在/,
    )
    const race = await taskManager.saveFolder('并发')
    await Promise.all([
      taskManager.moveTasks([second.id], race.id),
      taskManager.deleteFolder(race.id),
    ])
    assert.ok(
      (await taskManager.getTasks()).every((task) => !task.folderId),
      'Moving/removing concurrently cannot strand tasks',
    )
    const snapshot = await (await api.request('/')).json()
    assert.equal(snapshot.data.length, 3)
    assert.deepEqual(snapshot.folders, [])

    const { default: imageApi } = await import('../src/server/api/gpt-image')
    const { updateConfig } = await import('../src/server/common/config')
    const { templateManager } =
      await import('../src/server/common/template-manager')
    const sharp = (await import('sharp')).default
    const png = await sharp({
      create: { width: 16, height: 16, channels: 4, background: '#31556b' },
    })
      .png()
      .toBuffer()
    const upstreamBodies: Record<string, unknown>[] = []
    updateConfig({
      endpoints: [
        {
          id: 'fixture',
          name: 'fixture',
          apiKey: 'test-key',
          baseURL: 'http://folder-test.invalid/v1',
          model: 'gpt-image-1',
          type: 'custom',
          engine: 'openai-images',
        },
      ],
    })
    globalThis.fetch = (async (input, init) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      )
      assert.equal(
        url.hostname,
        'folder-test.invalid',
        'Generation test cannot contact real providers',
      )
      upstreamBodies.push(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch
    const generationFolder = await taskManager.saveFolder('生成目标')
    const stored = await templateManager.addTemplate({
      ...template,
      folder: '模板分类',
    })
    for (const route of ['/trial', '/generate']) {
      const body =
        route === '/trial'
          ? { prompt: 'test', title: 'trial' }
          : { templateId: stored.id }
      const response = await imageApi.request(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          endpointId: 'fixture',
          size: '1k',
          quality: 'medium',
          folderId: generationFolder.id,
          writeMetadata: false,
        }),
      })
      const result = await response.json()
      assert.equal(result.success, true, JSON.stringify(result))
      const task = (await taskManager.getTasks()).find(
        (item) => item.id === result.taskId,
      )
      assert.equal(
        task?.folderId,
        generationFolder.id,
        `${route} forwards the generation destination`,
      )
      assert.equal(task?.status, 'completed')
    }
    assert.ok(
      upstreamBodies.every((body) => !('folderId' in body)),
      'Local folders are not sent to image providers',
    )

    const { createFilesZip } = await import('../src/client/utils/download')
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3]))) as typeof fetch
    const file = {
      url: '/fixture.png',
      fileName: 'same',
      id: '1',
      createdAt: 1,
      endpointName: 'fixture',
    }
    const archive = await createFilesZip([
      file,
      { ...file, id: '2', folder: '改名' },
      { ...file, id: '3', folder: '改名' },
    ])
    const zip = await JSZip.loadAsync(await archive.arrayBuffer())
    const files = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
    assert.equal(
      files.length,
      3,
      'Duplicate titles/timestamps do not overwrite images',
    )
    assert.equal(files.filter((name) => name.startsWith('改名/')).length, 2)
    assert.equal(files.filter((name) => !name.includes('/')).length, 1)
    const folderArchive = await JSZip.loadAsync(
      await (await createFilesZip([{ ...file, folder: '改名' }])).arrayBuffer(),
    )
    assert.ok(
      Object.keys(folderArchive.files).some(
        (name) => name.startsWith('改名/') && !folderArchive.files[name].dir,
      ),
    )
    globalThis.fetch = (async () =>
      new Response('', { status: 500 })) as typeof fetch
    await assert.rejects(
      createFilesZip([file]),
      /HTTP 500/,
      'Failed downloads must not create a successful incomplete archive',
    )
    console.log(
      'Task folders: persistence, batch movement, concurrency, validation and ZIP paths passed',
    )
  } finally {
    globalThis.fetch = previousFetch
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('linai-task-folders-'))
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
