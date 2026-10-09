import JSZip from 'jszip'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { studioFileUrl } from '../src/shared/studio'
import {
  mapBackupImageUrls,
  TASK_BACKUP_MANIFEST,
} from '../src/shared/task-backup'

async function worker(mode: string, root: string, archivePath: string) {
  process.env.DATA_DIR = root
  await fs.mkdir(root, { recursive: true })
  const { taskManager, TaskManager } =
    await import('../src/server/common/task-manager')
  const { getConfig, updateConfig } =
    await import('../src/server/common/config')
  const { encryptApiKey } =
    await import('../src/server/module/gpt-image/encrypt')
  const { GENERATED_IMAGES_DIR, INPUT_IMAGES_DIR, deleteUnreferencedImages } =
    await import('../src/server/common/static')
  const { GENERATED_IMAGES_API_PATH, INPUT_IMAGES_API_PATH } =
    await import('../src/server/common/static/enum')
  const { studioManager } = await import('../src/server/common/studio-manager')
  const { restoreTaskBackup } = await import('../src/server/common/task-backup')
  const { default: api } = await import('../src/server/api/common/task')
  const sharp = (await import('sharp')).default
  const image = await sharp({
    create: { width: 16, height: 16, channels: 4, background: '#31556b' },
  })
    .png()
    .toBuffer()
  const readUrl = async (url: string) => {
    if (url.startsWith(INPUT_IMAGES_API_PATH))
      return fs.readFile(path.join(INPUT_IMAGES_DIR, path.basename(url)))
    if (url.startsWith(GENERATED_IMAGES_API_PATH))
      return fs.readFile(path.join(GENERATED_IMAGES_DIR, path.basename(url)))
    const id = /^\/api\/studio\/items\/([^/]+)\/file$/.exec(url)?.[1]
    assert.ok(id)
    return (await studioManager.file(id)).buffer
  }
  // No test is allowed to contact any image provider or external image URL.
  globalThis.fetch = (async () => {
    throw new Error('Unexpected network request')
  }) as typeof fetch

  if (mode === 'source') {
    updateConfig({
      endpoints: [
        {
          id: 'endpoint-fixture',
          name: '备份端点',
          model: 'fixture-model',
          baseURL: 'https://backup-fixture.invalid/v1',
          type: 'custom',
          engine: 'openai-images',
          apiKey: encryptApiKey('sk-fixture-backup-key'),
          balanceAccessToken: 'fixture-token',
          spicyLoras: [
            { path: 'https://fixture.invalid/model.safetensors', scale: 0.8 },
          ],
        },
      ],
    })
    const folder = await taskManager.saveFolder('备份文件夹')
    await taskManager.saveFolder('空文件夹')
    for (const filename of ['reference.png', 'mask.png'])
      await fs.writeFile(path.join(INPUT_IMAGES_DIR, filename), image)
    await fs.writeFile(path.join(GENERATED_IMAGES_DIR, 'result.png'), image)
    await fs.writeFile(
      path.join(GENERATED_IMAGES_DIR, 'second.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#31556b"/></svg>',
    )
    const shelf = await studioManager.upload(image, '参考素材.png')
    const reference = `${INPUT_IMAGES_API_PATH}/reference.png`
    const mask = `${INPUT_IMAGES_API_PATH}/mask.png`
    const result = `${GENERATED_IMAGES_API_PATH}/result.png`
    const template = {
      id: 'missing-template',
      title: '精确文本 {prompt}',
      prompt: '优化后的提示词\n{prompt}',
      endpointId: 'endpoint-fixture',
      images: [reference],
      usageType: 'image' as const,
      createdAt: 123,
      n: 2,
      aspectRatio: '4:3',
      injectAspectRatio: true,
    }
    const first = await taskManager.createTaskFromTemplate({
      template,
      source: 'fixture-model',
      folderId: folder.id,
      endpointName: '备份端点',
      originalPrompt: '优化前提示词\n{prompt}，保留标点。',
    })
    await taskManager.updateTask(first.id, {
      status: 'completed',
      outputUrls: [result, `${GENERATED_IMAGES_API_PATH}/second.svg`],
      unknownFutureMetadata: { text: 'preserved' },
      novelaiSnapshots: [
        {
          version: 1,
          seed: 42,
          requestedSeed: 42,
          batchSize: 1,
          imageIndex: 0,
          request: {
            prompt: 'snapshot',
            negativePrompt: '',
            model: 'fixture',
            width: 1024,
            height: 1024,
            steps: 28,
            scale: 5,
            cfgRescale: 0,
            sampler: 'k_euler',
            noiseSchedule: 'karras',
            seed: 42,
            n: 1,
            qualityToggle: false,
            action: 'infill',
            referenceImageUrl: reference,
            maskImageUrl: mask,
            strength: 0.6,
            noise: 0,
            characters: [],
            preciseReference: {
              imageUrl: result,
              type: 'style',
              fidelity: 1,
              strength: 1,
            },
            folderId: folder.id,
          },
        },
      ],
    })
    const second = await taskManager.createTaskFromTemplate({
      template: {
        ...template,
        id: 'legacy-template',
        images: [studioFileUrl(shelf.id)],
      },
      source: 'legacy',
      endpointName: '备份端点',
    })
    await taskManager.updateTask(second.id, {
      status: 'completed',
      outputUrl: result,
      studioItemId: shelf.id,
      studioProvenance: {
        origin: 'civitai',
        sourceTaskId: first.id,
        civitai: {
          version: 1,
          workflowId: 'fixture',
          imageIndex: 0,
          seed: 7,
          request: {
            model: {
              modelId: 1,
              versionId: 2,
              name: 'fixture',
              baseModel: 'SDXL 1.0',
              type: 'Checkpoint',
            },
            loras: [],
            prompt: 'civitai',
            negativePrompt: '',
            width: 1024,
            height: 1024,
            steps: 20,
            scale: 5,
            sampler: 'euler',
            schedule: 'karras',
            seed: 7,
            n: 1,
            clipSkip: 1,
            referenceItemId: shelf.id,
            strength: 0.6,
            allowMatureContent: false,
            saveToTaskList: true,
          },
        },
      },
    })
    const pending = await taskManager.createTaskFromTemplate({
      template,
      source: 'unfinished',
    })
    await taskManager.updateTask(pending.id, {
      imageBilling: { status: 'pending' } as any,
    })
    const response = await api.request('/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadedTaskIds: [first.id, 'stale'] }),
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'application/zip')
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    const archive = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(archivePath, archive)
    const zip = await JSZip.loadAsync(archive)
    const manifest = JSON.parse(
      await zip.file(TASK_BACKUP_MANIFEST)!.async('string'),
    )
    assert.equal(manifest.tasks.length, 3)
    assert.equal(manifest.folders.length, 2)
    assert.equal(
      manifest.tasks[0].originalPrompt,
      '优化前提示词\n{prompt}，保留标点。',
    )
    assert.deepEqual(manifest.downloadedTaskIds, [first.id])
    assert.equal(
      manifest.assets.length,
      5,
      'Outputs, input reference, mask and shelf file are included',
    )
    assert.equal(manifest.studioItems.length, 1)
    assert.equal(manifest.endpoints[0].balanceAccessToken, 'fixture-token')
    for (const asset of manifest.assets)
      assert.deepEqual(
        await zip.file(asset.path)!.async('nodebuffer'),
        await readUrl(asset.url),
      )
    // A missing reference must fail the whole archive, not silently omit the file.
    await fs.unlink(path.join(INPUT_IMAGES_DIR, 'reference.png'))
    const failed = await api.request('/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(failed.status, 400)
    assert.match((await failed.json()).error, /图片已丢失/)
    console.log(
      'Source: complete archive and missing-reference rejection passed',
    )
    return
  }

  const archive = await fs.readFile(archivePath)
  const zip = await JSZip.loadAsync(archive)
  const backup = JSON.parse(
    await zip.file(TASK_BACKUP_MANIFEST)!.async('string'),
  )
  const folder = await taskManager.saveFolder('备份文件夹')
  const conflictingEndpoint = {
    ...backup.endpoints[0],
    baseURL: 'https://existing-fixture.invalid/v1',
    apiKey: 'existing-key',
  }
  updateConfig({ endpoints: [conflictingEndpoint] })
  const existing = {
    ...backup.tasks[0],
    folderId: folder.id,
    rawTemplate: {
      ...backup.tasks[0].rawTemplate,
      prompt: 'existing',
      images: [],
    },
    outputUrls: [`${GENERATED_IMAGES_API_PATH}/result.png`],
    novelaiSnapshots: undefined,
  }
  await taskManager.addCompletedTask(existing)
  await fs.writeFile(
    path.join(GENERATED_IMAGES_DIR, 'result.png'),
    'existing image',
  )
  let notifications = 0
  taskManager.on('tasks-updated', () => notifications++)
  const response = await api.request('/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: new Uint8Array(archive),
  })
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json()
  assert.equal(result.taskCount, 3)
  assert.equal(result.imageCount, 5)
  assert.equal(result.endpointCount, 1)
  assert.equal(
    notifications,
    1,
    'Committed restoration refreshes the task list',
  )
  const tasks = await taskManager.getTasks()
  assert.equal(tasks.length, 4)
  assert.deepEqual(tasks[0], JSON.parse(JSON.stringify(existing)))
  assert.equal(
    await fs.readFile(path.join(GENERATED_IMAGES_DIR, 'result.png'), 'utf8'),
    'existing image',
    'Existing same-name image is never overwritten',
  )
  const restored = tasks.slice(1)
  assert.equal(restored[0].folderId, folder.id, 'Same-name folder is merged')
  assert.equal(
    (await taskManager.getFolders()).length,
    2,
    'Empty folders are restored',
  )
  assert.notEqual(
    restored[0].id,
    existing.id,
    'Conflicting task IDs get fresh IDs',
  )
  assert.equal(restored[0].originalPrompt, backup.tasks[0].originalPrompt)
  assert.deepEqual(restored[0].unknownFutureMetadata, { text: 'preserved' })
  assert.equal(
    restored[0].rawTemplate.prompt,
    backup.tasks[0].rawTemplate.prompt,
  )
  assert.equal(restored[0].novelaiSnapshots?.[0].request.folderId, folder.id)
  assert.equal(restored[2].status, 'failed')
  assert.equal(restored[2].imageBilling?.status, 'unavailable')
  assert.deepEqual(result.downloadedTaskIds, [restored[0].id])
  const restoredEndpoint = getConfig().endpoints.find(
    (item) => item.id === restored[0].rawTemplate.endpointId,
  )!
  assert.equal(restoredEndpoint.baseURL, backup.endpoints[0].baseURL)
  assert.equal(
    restoredEndpoint.balanceAccessToken,
    backup.endpoints[0].balanceAccessToken,
  )
  assert.deepEqual(getConfig().endpoints[0], conflictingEndpoint)
  assert.notEqual(restoredEndpoint.id, conflictingEndpoint.id)
  assert.equal(restored[1].studioProvenance?.sourceTaskId, restored[0].id)
  const shelfId =
    restored[1].studioProvenance?.civitai?.request.referenceItemId!
  assert.notEqual(shelfId, backup.studioItems[0].id)
  assert.equal(restored[1].studioItemId, shelfId)
  const originalUrls: string[] = []
  const restoredUrls: string[] = []
  mapBackupImageUrls(backup.tasks, (url) => {
    originalUrls.push(url)
    return url
  })
  mapBackupImageUrls(restored, (url) => {
    restoredUrls.push(url)
    return url
  })
  assert.equal(restoredUrls.length, originalUrls.length)
  for (let index = 0; index < restoredUrls.length; index++) {
    const asset = backup.assets.find(
      (asset: any) => asset.url === originalUrls[index],
    )
    assert.ok(asset)
    assert.deepEqual(
      await readUrl(restoredUrls[index]),
      await zip.file(asset.path)!.async('nodebuffer'),
      'All restored image references resolve to original bytes',
    )
  }
  assert.deepEqual(
    await new TaskManager().getTasks(),
    tasks,
    'Tasks survive restart',
  )
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'))
      .endpoints,
    getConfig().endpoints,
  )
  const references = restored.flatMap((task) => task.rawTemplate.images)
  await deleteUnreferencedImages({ type: 'input' })
  for (const url of references) await readUrl(url)

  const beforeTasks = await taskManager.getTasks()
  const beforeFolders = await taskManager.getFolders()
  const beforeEndpoints = structuredClone(getConfig().endpoints)
  const beforeShelf = await studioManager.list()
  const beforeInput = await fs.readdir(INPUT_IMAGES_DIR)
  const beforeOutput = await fs.readdir(GENERATED_IMAGES_DIR)
  const assertUnchanged = async () => {
    assert.deepEqual(await taskManager.getTasks(), beforeTasks)
    assert.deepEqual(await taskManager.getFolders(), beforeFolders)
    assert.deepEqual(getConfig().endpoints, beforeEndpoints)
    assert.deepEqual(await studioManager.list(), beforeShelf)
    assert.deepEqual(await fs.readdir(INPUT_IMAGES_DIR), beforeInput)
    assert.deepEqual(await fs.readdir(GENERATED_IMAGES_DIR), beforeOutput)
  }
  const malformed = async (
    edit: (manifest: any, archive: JSZip) => void,
    pattern: RegExp,
  ) => {
    const broken = await JSZip.loadAsync(archive)
    const manifest = structuredClone(backup)
    edit(manifest, broken)
    broken.file(TASK_BACKUP_MANIFEST, JSON.stringify(manifest))
    await assert.rejects(
      restoreTaskBackup(await broken.generateAsync({ type: 'nodebuffer' })),
      pattern,
    )
    await assertUnchanged()
  }
  await malformed((manifest) => {
    manifest.version = 999
  }, /版本不受支持/)
  await malformed((manifest) => {
    manifest.tasks.push(manifest.tasks[0])
  }, /重复编号/)
  await malformed((manifest) => {
    manifest.tasks[0].rawTemplate.images = [
      '/api/static/images/input/missing.png',
    ]
  }, /引用的图片/)
  await malformed((manifest, broken) => {
    broken.remove(manifest.assets[0].path)
  }, /缺少图片文件/)
  await malformed((manifest, broken) => {
    broken.file(
      manifest.assets[0].path,
      Buffer.alloc(manifest.assets[0].bytes, 3),
    )
  }, /校验失败/)
  await malformed((manifest) => {
    manifest.assets[0].bytes = 1
  }, /解压大小/)
  await malformed((_, broken) => {
    broken.file('../evil.txt', 'evil')
  }, /路径无效/)
  await malformed((manifest) => {
    const originalUrl = manifest.assets[0].url
    const unsafeUrl = '/api/static/images/input/../../config.json'
    manifest.assets[0].url = unsafeUrl
    manifest.tasks = mapBackupImageUrls(manifest.tasks, (url) =>
      url === originalUrl ? unsafeUrl : url,
    )
  }, /图片地址无效/)
  await malformed((manifest) => {
    manifest.tasks[1].studioProvenance.civitai.request.referenceItemId =
      'missing'
  }, /引用的素材/)
  await assert.rejects(restoreTaskBackup(Buffer.from('not a zip')), /ZIP 无效/)
  await assertUnchanged()

  // Simulate task persistence failing after images/endpoints/shelf imports.
  const originalRestore = taskManager.restoreTasks.bind(taskManager)
  taskManager.restoreTasks = async () => {
    throw new Error('fixture write failure')
  }
  // Force a new endpoint too, to exercise credential rollback.
  const failureZip = await JSZip.loadAsync(archive)
  const failureManifest = structuredClone(backup)
  failureManifest.endpoints[0].apiKey = 'new-fixture-key'
  failureZip.file(TASK_BACKUP_MANIFEST, JSON.stringify(failureManifest))
  try {
    await assert.rejects(
      restoreTaskBackup(await failureZip.generateAsync({ type: 'nodebuffer' })),
      /fixture write failure/,
    )
    await assertUnchanged()
  } finally {
    taskManager.restoreTasks = originalRestore
  }
  const repeated = await restoreTaskBackup(archive)
  assert.equal(
    repeated.endpointCount,
    0,
    'Repeated restore reuses identical endpoint configuration',
  )
  assert.equal(getConfig().endpoints.length, beforeEndpoints.length)
  assert.equal(
    (await taskManager.getTasks()).length,
    7,
    'Repeated restore appends tasks without overwrites',
  )
  console.log(
    'Destination: isolated round trip, references, collision handling, persistence, malformed ZIP rejection and rollback passed',
  )
}

async function main() {
  const [mode, root, archive] = process.argv.slice(2)
  if (mode) return worker(mode, root, archive)
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-task-backup-'))
  try {
    const source = path.join(fixture, 'source')
    const destination = path.join(fixture, 'destination')
    const archivePath = path.join(fixture, 'backup.zip')
    for (const mode of ['source', 'destination']) {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          path.resolve('scripts/test-task-backup.ts'),
          mode,
          mode === 'source' ? source : destination,
          archivePath,
        ],
        { encoding: 'utf8' },
      )
      process.stdout.write(result.stdout)
      process.stderr.write(result.stderr)
      assert.equal(result.status, 0)
      if (mode === 'source') {
        assert.equal(path.dirname(source), fixture)
        await fs.rm(source, { recursive: true, force: true })
      }
    }
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()))
    assert.ok(path.basename(fixture).startsWith('linai-task-backup-'))
    await fs.rm(fixture, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
