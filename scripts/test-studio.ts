import fs from 'fs-extra'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-studio-test-'))
  process.env.DATA_DIR = root
  try {
    const { studioManager, StudioManager } =
      await import('../src/server/common/studio-manager')
    const { taskManager } = await import('../src/server/common/task-manager')
    const { default: api } = await import('../src/server/api/studio')
    const { embedPngTextMetadata } =
      await import('../src/server/module/gpt-image/generation-metadata')
    const raw = await sharp({
      create: { width: 32, height: 24, channels: 4, background: '#287ca8' },
    })
      .png()
      .toBuffer()
    const bytes = embedPngTextMetadata(
      raw,
      'parameters',
      'test prompt\nSteps: 28, Seed: 1234',
    )
    const id = randomUUID()
    await fs.writeFile(path.join(root, 'images/generated/original.png'), bytes)
    await taskManager.addCompletedTask({
      id,
      rawTemplate: {
        id: 'template',
        title: '原图',
        prompt: 'test prompt',
        images: [],
        usageType: 'image',
        createdAt: 1,
      },
      source: 'nai-diffusion-4-5-full',
      endpointName: 'NovelAI',
      status: 'completed',
      createdAt: 1,
      outputUrls: ['/api/static/images/generated/original.png'],
    })
    const copied = await studioManager.fromTask(id, 0)
    assert.equal(copied.provenance.origin, 'novelai')
    assert.match(copied.provenance.sourceMetadata!.parameters, /Seed: 1234/)
    const document = await studioManager.document(copied.id)
    await studioManager.remove([copied.id], true)
    const edited = await studioManager.upload(raw, 'edited.png', document.id)
    assert.equal(edited.provenance.photopea, 'edited')
    assert.equal(edited.provenance.template!.prompt, 'test prompt')
    const exported = (await studioManager.file(edited.id)).buffer
    assert.ok(exported.includes(Buffer.from('openLinAIStudio')))
    assert.ok(exported.includes(Buffer.from('Seed: 1234')))
    assert.deepEqual(
      await sharp(exported).raw().toBuffer(),
      await sharp(raw).raw().toBuffer(),
    )
    const archived = await studioManager.archive(edited.id)
    assert.deepEqual(
      await studioManager.archive(edited.id),
      archived,
      'Archive is idempotent',
    )
    const reference = await studioManager.reference(edited.id)
    const newDocument = await studioManager.document()
    const created = await studioManager.upload(raw, 'new.png', newDocument.id)
    assert.deepEqual(created.provenance, {
      origin: 'photopea',
      photopea: 'created',
    })
    await studioManager.pin(created.id, true)
    const removeResult = await studioManager.remove(
      [edited.id, created.id],
      true,
    )
    assert.equal(removeResult.removed, 1)
    assert.equal((await studioManager.list())[0].id, created.id)
    assert.equal(
      (await new StudioManager().list())[0].pinned,
      true,
      'Pins survive manager restart',
    )
    assert.ok(
      await fs.pathExists(
        path.join(root, 'images/input', path.basename(reference.url)),
      ),
    )
    const archivedTask = (await taskManager.getTasks()).find(
      (task) => task.id === archived.taskId,
    )!
    assert.ok(
      await fs.pathExists(
        path.join(
          root,
          'images/generated',
          path.basename(archivedTask.outputUrls![0]),
        ),
      ),
    )
    assert.ok(
      await fs.pathExists(path.join(root, 'images/generated/original.png')),
    )
    await studioManager.remove([created.id], false)
    assert.equal(
      (await studioManager.list()).length,
      0,
      'Pinned items may be individually deleted',
    )
    const a = await studioManager.upload(raw, 'a.png')
    const b = await studioManager.upload(raw, 'b.png')
    await Promise.all([
      studioManager.pin(a.id, true),
      studioManager.remove([a.id, b.id], true),
    ])
    assert.deepEqual(
      (await studioManager.list()).map((item) => item.id),
      [a.id],
      'Pin/empty serialized',
    )
    await assert.rejects(
      studioManager.upload(Buffer.from('<html>bad image</html>'), 'bad.png'),
    )
    const bad = await api.request('/items/not-a-uuid/file')
    assert.equal(bad.status, 400)
    const badDoc = await api.request('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: '../../outside' }),
    })
    assert.equal(badDoc.status, 400)
    const body = new FormData()
    body.append(
      'file',
      new File([new Uint8Array(raw)], 'upload.png', { type: 'image/png' }),
    )
    const uploaded = await api.request('/items', { method: 'POST', body })
    assert.equal(uploaded.status, 200)
    assert.equal((await uploaded.json()).data.provenance.origin, 'import')
    console.log(
      'Studio integration: copy/provenance, PNG metadata/pixels, archive/reference isolation, idempotency, pin/empty concurrency, persistence, upload validation passed',
    )
  } finally {
    await fs.remove(root)
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
