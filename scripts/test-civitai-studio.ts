import fs from 'fs-extra'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type { CivitaiGenerateRequest } from '../src/shared/civitai-generation'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-civitai-test-'))
  process.env.DATA_DIR = root
  const originalFetch = globalThis.fetch
  try {
    const {
      CivitaiGenerationManager,
      civitaiGenerateSchema,
      buildCivitaiWorkflow,
    } = await import('../src/server/module/civitai-generation')
    const { studioProviderSettings } =
      await import('../src/server/common/studio-provider-settings')
    const { studioManager } =
      await import('../src/server/common/studio-manager')
    const { taskManager } = await import('../src/server/common/task-manager')
    const { studioGenerationParameters } =
      await import('../src/client/pages/common/Studio/studio-parameters')
    const { default: api } = await import('../src/server/api/studio')
    await studioProviderSettings.updateCivitai({
      apiKey: 'test-civitai-secret',
    })
    const png = await sharp({
      create: { width: 32, height: 24, channels: 4, background: '#5588aa' },
    })
      .png()
      .toBuffer()
    const input: CivitaiGenerateRequest = {
      model: {
        modelId: 1,
        versionId: 11,
        name: 'Test',
        baseModel: 'Illustrious',
        type: 'Checkpoint',
      },
      loras: [
        {
          modelId: 2,
          versionId: 22,
          name: 'Lora',
          baseModel: 'Illustrious',
          type: 'LORA',
          strength: 0.7,
        },
      ],
      prompt: 'a stone lion',
      negativePrompt: 'blur',
      width: 1024,
      height: 1024,
      steps: 25,
      scale: 7,
      sampler: 'euler',
      schedule: 'discrete',
      seed: 123,
      n: 2,
      clipSkip: 2,
      strength: 0.7,
      allowMatureContent: false,
      saveToTaskList: false,
    }
    let paidSubmissions = 0
    let estimates = 0
    let workflowStatus = 'processing'
    let failSecondDownload = false
    let failSubmit = 0
    let resourceAvailable = true
    const resourceHosts: string[] = []
    const searchHosts: string[] = []
    let savedBody: any
    let workflowId = 'wf_test'
    const downloaded: string[] = []
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    const workflow = () => ({
      id: workflowId,
      status: workflowStatus,
      cost: { total: 16 },
      steps: [0, 1].map((index) => ({
        name: `image-${index}`,
        status: workflowStatus,
        estimatedProgressRate: 0.4,
        ...(workflowStatus === 'succeeded'
          ? {
              output: {
                images: [
                  {
                    id: `${workflowId}-${index}`,
                    available: true,
                    url: `https://images.example/${workflowId}/${index}`,
                  },
                ],
              },
            }
          : {}),
      })),
    })
    globalThis.fetch = async (rawUrl, init) => {
      const url = new URL(String(rawUrl))
      if (url.hostname === 'images.example') {
        assert.equal(
          new Headers(init?.headers).get('Authorization'),
          null,
          'Never forward API keys to result hosts',
        )
        if (failSecondDownload && url.pathname.endsWith('/1'))
          return new Response('', { status: 503 })
        downloaded.push(url.pathname)
        return new Response(new Uint8Array(png))
      }
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer test-civitai-secret',
      )
      if (url.hostname === 'civitai.com' || url.hostname === 'civitai.red') {
        if (url.pathname === '/api/v1/models') {
          searchHosts.push(url.hostname)
          assert.equal(url.searchParams.get('supportsGeneration'), 'true')
          assert.equal(
            url.searchParams.get('nsfw'),
            url.hostname === 'civitai.red' ? 'true' : 'false',
          )
          return json({
            items: [{
              id: 1,
              name: 'Model',
              type: 'Checkpoint',
              supportsGeneration: true,
              modelVersions: [{
                id: 11,
                name: 'v1',
                baseModel: 'Illustrious',
                supportsGeneration: true,
              }],
            }],
            metadata: {},
          })
        }
        assert.match(url.pathname, /^\/api\/v1\/model-versions\/mini\/(11|22)$/)
        resourceHosts.push(url.hostname)
        const lora = url.pathname.endsWith('/22')
        return json({
          air: `urn:air:sdxl:${lora ? 'lora' : 'checkpoint'}:civitai:${lora ? 2 : 1}@${lora ? 22 : 11}`,
          modelName: lora ? 'LoRA' : 'Model',
          versionName: 'v1',
          baseModel: 'Illustrious',
          canGenerate: resourceAvailable,
        })
      }
      assert.equal(
        url.hostname,
        'orchestration.civitai.com',
        'Tests must never call an unexpected endpoint',
      )
      if (init?.method === 'POST') {
        savedBody = JSON.parse(String(init.body))
        if (url.searchParams.get('whatif') === 'true') {
          estimates++
          return json(workflow())
        }
        paidSubmissions++
        if (failSubmit)
          return json({ detail: 'simulated rejection' }, failSubmit)
        return json(workflow(), 202)
      }
      if (url.searchParams.has('tags')) return json({ items: [workflow()] })
      return json(workflow())
    }

    const manager = new CivitaiGenerationManager()
    assert.equal((await manager.estimate(input)).cost, 16)
    assert.deepEqual(resourceHosts, ['civitai.com', 'civitai.com'])
    resourceHosts.length = 0
    assert.equal((await manager.estimate({ ...input, site: 'red' })).cost, 16)
    assert.deepEqual(resourceHosts, ['civitai.red', 'civitai.red'])
    resourceHosts.length = 0
    const redSearch = await api.request('/providers/civitai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: 'red' }),
    })
    assert.equal(redSearch.status, 200)
    assert.deepEqual(searchHosts, ['civitai.red'])
    assert.equal(
      (await redSearch.json()).data.items[0].versions[0].supportsGeneration,
      true,
    )
    assert.equal(estimates, 2)
    assert.equal(paidSubmissions, 0, 'whatif must not create paid jobs')
    assert.equal(savedBody.steps[0].input.engine, 'sdcpp')
    assert.equal(
      savedBody.steps[0].input.clipSkip,
      undefined,
      'SDXL must not receive clipSkip',
    )
    assert.deepEqual(savedBody.steps[0].input.loras, {
      'urn:air:sdxl:lora:civitai:2@22': 0.7,
    })
    assert.equal(savedBody.steps[1].input.seed, 124)
    assert.equal(savedBody.steps[0].input.operation, 'createImage')
    const sd1 = buildCivitaiWorkflow(
      { ...input, model: { ...input.model, baseModel: 'SD 1.5' }, loras: [] },
      [10],
    )
    assert.equal(sd1.steps[0].input.clipSkip, 2)
    assert.equal(sd1.steps[0].input.ecosystem, 'sd1')
    assert.equal(
      civitaiGenerateSchema.safeParse({ ...input, width: 1000 }).success,
      false,
    )
    assert.equal(
      civitaiGenerateSchema.safeParse({
        ...input,
        loras: [{ ...input.loras[0], baseModel: 'Pony' }],
      }).success,
      false,
    )
    assert.equal(
      civitaiGenerateSchema.safeParse({
        ...input,
        loras: [input.loras[0], input.loras[0]],
      }).success,
      false,
    )
    assert.equal(
      civitaiGenerateSchema.safeParse({
        ...input,
        model: { ...input.model, baseModel: 'Flux.1 D' },
      }).success,
      false,
    )
    resourceAvailable = false
    await assert.rejects(manager.submit(randomUUID(), input), /不可在线生成/)
    resourceAvailable = true
    assert.equal(paidSubmissions, 0)

    const id = randomUUID()
    await Promise.all([manager.submit(id, input), manager.submit(id, input)])
    assert.equal(
      paidSubmissions,
      1,
      'Concurrent retry of the same ID must submit once',
    )
    assert.equal((await manager.poll(id)).progress, 40)
    assert.equal((await manager.list())[0].id, id)
    workflowStatus = 'succeeded'
    failSecondDownload = true
    const partial = await manager.poll(id)
    assert.equal(partial.items.length, 1)
    assert.equal(partial.settled, false)
    assert.match(partial.error!, /不会重新生成/)
    failSecondDownload = false
    const restarted = new CivitaiGenerationManager()
    const complete = await restarted.poll(id)
    assert.equal(complete.items.length, 2)
    assert.equal(complete.settled, true)
    assert.equal(
      downloaded.filter((entry) => entry.endsWith('/0')).length,
      1,
      'Retry must preserve already saved images',
    )
    assert.equal((await studioManager.list()).length, 2)
    assert.equal(
      (await taskManager.getTasks()).length,
      0,
      'Task autosave defaults off',
    )
    assert.equal(paidSubmissions, 1)
    const snapshot = complete.items[1].provenance.civitai!
    assert.equal(snapshot.seed, 124)
    assert.equal(snapshot.request.n, 1)
    assert.equal(
      studioGenerationParameters(complete.items[1])!.civitai!.loras[0].strength,
      0.7,
    )
    assert.ok(!JSON.stringify(complete).includes('test-civitai-secret'))
    assert.equal(
      'request' in complete,
      false,
      'Job transport exposes only public state',
    )
    const file = await studioManager.file(complete.items[0].id)
    assert.ok(file.buffer.includes(Buffer.from('openLinAIStudio')))
    const document = await studioManager.document(complete.items[0].id)
    const edited = await studioManager.upload(png, 'edited.png', document.id)
    assert.equal(
      edited.provenance.civitai!.workflowId,
      workflowId,
      'Photopea roundtrip preserves generation settings',
    )
    await restarted.poll(id)
    assert.equal(downloaded.length, 2)

    const reference = await studioManager.upload(png, 'reference.png')
    await manager.estimate({ ...input, referenceItemId: reference.id })
    assert.equal(savedBody.steps[0].input.operation, 'createVariant')
    assert.ok(
      savedBody.steps[0].input.image.startsWith('data:image/png;base64,'),
    )
    assert.equal(savedBody.steps[0].input.strength, 0.7)

    workflowId = 'wf_autosave'
    const archiveId = randomUUID()
    await manager.submit(archiveId, { ...input, saveToTaskList: true })
    const archived = await manager.poll(archiveId)
    assert.equal(archived.items.length, 2)
    assert.equal((await taskManager.getTasks()).length, 2)
    await manager.poll(archiveId)
    assert.equal(
      (await taskManager.getTasks()).length,
      2,
      'Archive must be idempotent',
    )

    failSubmit = 503
    workflowId = 'wf_recovered'
    const unknownId = randomUUID()
    assert.equal(
      (await manager.submit(unknownId, input)).status,
      'unknown',
      '5xx can hide a successful submission',
    )
    const beforeRecovery = paidSubmissions
    failSubmit = 0
    assert.equal(
      (await new CivitaiGenerationManager().poll(unknownId)).settled,
      true,
    )
    assert.equal(
      paidSubmissions,
      beforeRecovery,
      'Unknown submission recovers by tag without submitting again',
    )
    failSubmit = 403
    const rejected = await manager.submit(randomUUID(), input)
    assert.equal(rejected.status, 'failed')
    assert.equal(rejected.settled, true)
    assert.match(rejected.error!, /403/)

    const invalid = await api.request('/providers/civitai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '../escape', request: input }),
    })
    assert.equal(invalid.status, 400)
    const listResponse = await api.request('/providers/civitai/jobs')
    const publicJson = await listResponse.json()
    assert.equal(publicJson.success, true)
    assert.ok(!JSON.stringify(publicJson).includes('test-civitai-secret'))
    console.log(
      'Civitai Studio: estimate, resource validation, payloads, img2img, persistence, idempotency, partial-save recovery, metadata, autosave, error recovery and API validation passed.',
    )
  } finally {
    globalThis.fetch = originalFetch
    const resolved = path.resolve(root)
    assert.ok(
      resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(resolved).startsWith('linai-civitai-test-'),
    )
    await fs.remove(resolved)
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
