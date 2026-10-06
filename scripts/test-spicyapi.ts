import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-spicyapi-'))
  const originalDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = directory
  const originalFetch = globalThis.fetch
  const baseURL = 'https://spicy.test/api/v1'
  const apiKey = 'test-key'
  const seedream = 'bytedance/seedream-5.0-flash/text-to-image'
  const qwen = 'alibaba/qwen-image-2.1-lora/text-to-image'
  const otherLora = 'other/future-lora/text-to-image'
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  )
  const records = new Map<string, any>()
  for (const model of [seedream, qwen, otherLora]) {
    for (const edit of [false, true]) {
      const id = edit ? model.replace('/text-to-image', '/edit') : model
      records.set(id, {
        model: id,
        displayName: id,
        enabled: true,
        available: true,
        modality: 'image',
        tasks: [edit ? 'image-to-image' : 'text-to-image'],
        inputSchema: {
          required: ['prompt', ...(edit ? ['image_urls'] : [])],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 5000 },
            resolution: { enum: ['1k', '1.5k', '2k'] },
            aspect_ratio: { enum: ['1:1', '3:4'] },
            output_format: { enum: ['jpeg', 'png'] },
            ...(edit
              ? {
                  image_urls: {
                    minItems: 1,
                    maxItems: 10,
                    items: { contentMediaType: ['image/png'] },
                  },
                }
              : {}),
            ...(model !== seedream
              ? {
                  seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
                  loras: {
                    maxItems: model === otherLora ? 2 : 3,
                    items: {
                      required: ['path', 'scale'],
                      properties: {
                        path: { type: 'string' },
                        scale: {
                          minimum: 0,
                          maximum: model === otherLora ? 1.5 : 4,
                        },
                      },
                    },
                  },
                }
              : {}),
          },
        },
      })
    }
  }
  const requests: Array<{ url: string; body: any; init?: RequestInit }> = []
  const jobs = new Map<string, any>()
  const polls = new Map<string, number>()
  let successCount = 0
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const body =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ url, body, init })
    const json = (data: any, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (url.startsWith(baseURL))
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer test-key',
      )
    if (url.includes('/models?')) {
      const task = new URL(url).searchParams.get('task')
      return json({
        code: 200,
        data: {
          items: [...records.values()].filter((item) =>
            item.tasks.includes(task),
          ),
        },
      })
    }
    if (url.includes('/models/'))
      return json({
        code: 200,
        data: records.get(decodeURIComponent(url.split('/models/')[1])),
      })
    if (url.endsWith('/common/upload-url')) {
      assert.equal(body.bytes, image.length)
      assert.equal(body.contentType, 'image/png')
      return json({
        code: 200,
        data: {
          fileId: 'file-1',
          uploadUrl: 'https://storage.test/upload',
          method: 'PUT',
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(image.length),
          },
          maxBytes: 10485760,
        },
      })
    }
    if (url === 'https://storage.test/upload') {
      assert.equal(new Headers(init?.headers).has('Authorization'), false)
      assert.equal(
        new Headers(init?.headers).get('Content-Length'),
        String(image.length),
      )
      assert.deepEqual(Buffer.from(init?.body as Uint8Array), image)
      return new Response(null, { status: 200 })
    }
    if (url.endsWith('/files/file-1/commit')) {
      assert.equal(init?.method, 'POST')
      return json({
        code: 200,
        data: { status: 'ready', uri: 'spicy://f/file-1' },
      })
    }
    if (url.endsWith('/jobs/createTask')) {
      assert.match(
        new Headers(init?.headers).get('Idempotency-Key')!,
        /^[0-9a-f-]{36}$/,
      )
      if (body.input.prompt === 'submit-fails')
        return json({ code: 40201, msg: 'No funds' }, 402)
      const taskId = 'job-' + (jobs.size + 1)
      jobs.set(taskId, body)
      return json(
        { code: 200, data: { taskId, state: 'queued', estimatedCost: '999' } },
        202,
      )
    }
    if (url.includes('/jobs/recordInfo?')) {
      const taskId = new URL(url).searchParams.get('taskId')!
      const prompt = jobs.get(taskId).input.prompt
      const count = (polls.get(taskId) || 0) + 1
      polls.set(taskId, count)
      if (prompt === 'retry' && count === 1) return json({ msg: 'busy' }, 503)
      if (prompt === 'denied')
        return json({
          code: 200,
          data: {
            state: 'failed',
            errorCode: 'model_error',
            errorMessage: 'bad weights',
          },
        })
      if (prompt === 'unknown')
        return json({ code: 200, data: { state: 'unexpected' } })
      if (prompt === 'timeout' || (prompt === 'retry' && count === 2))
        return json({ code: 200, data: { state: 'running' } })
      if (prompt === 'no-output')
        return json({ code: 200, data: { state: 'succeeded', output: {} } })
      if (prompt.startsWith('partial') && ++successCount === 2)
        return json({
          code: 200,
          data: { state: 'expired', errorMessage: 'expired' },
        })
      return json({
        code: 200,
        data: {
          state: 'succeeded',
          output: {
            assets: [{ mime: 'image/png', url: 'https://storage.test/result' }],
          },
          cost: '0.03',
          settled: prompt !== 'unsettled',
        },
      })
    }
    if (url === 'https://storage.test/result') {
      assert.equal(new Headers(init?.headers).has('Authorization'), false)
      return new Response(image, { headers: { 'Content-Type': 'image/png' } })
    }
    if (url.endsWith('/chat/credit'))
      return json({
        code: 200,
        data: { available: '12.5', total: '13', held: '0.5' },
      })
    throw new Error('Unexpected mock URL: ' + url)
  }
  try {
    const { spicyBaseURL } = await import('../src/shared/spicyapi')
    const { buildSpicyImageBody, generateSpicyImage, uploadSpicyImage } =
      await import('../src/server/module/gpt-image/spicyapi-api')
    const { handleSpicyImageGeneration } =
      await import('../src/server/module/gpt-image/spicyapi-image')
    const { listModelCatalog } =
      await import('../src/server/module/model-catalog')
    const { taskManager } = await import('../src/server/common/task-manager')
    const { INPUT_IMAGES_DIR, GENERATED_IMAGES_DIR } =
      await import('../src/server/common/static')
    const { templateManager } =
      await import('../src/server/common/template-manager')
    const { updateConfig, getConfig } =
      await import('../src/server/common/config')
    const { default: gptImageApi } = await import('../src/server/api/gpt-image')
    for (const value of [
      'https://spicy.test',
      'https://spicy.test/v1',
      baseURL + '/',
    ])
      assert.equal(spicyBaseURL(value), baseURL)
    const build = (model = qwen, patch: Record<string, any> = {}) =>
      buildSpicyImageBody({
        model,
        record: records.get(model),
        prompt: 'hello',
        aspectRatio: '3:4',
        resolution: '1.5k',
        images: [],
        ...patch,
      })
    assert.deepEqual(build(seedream).input, {
      prompt: 'hello',
      aspect_ratio: '3:4',
      resolution: '1.5k',
      output_format: 'png',
    })
    const loras = [{ path: 'https://weights.test/model.safetensors', scale: 1 }]
    assert.deepEqual(build(otherLora, { loras, seed: 7 }).input.loras, loras)
    assert.throws(() => build(seedream, { loras }), /不支持参数 loras/)
    assert.throws(() => build(qwen, { resolution: '4k' }), /不支持 resolution/)
    assert.throws(
      () => build(qwen, { aspectRatio: 'auto' }),
      /不支持 aspect_ratio/,
    )
    assert.throws(() => build(qwen, { prompt: 'x'.repeat(5001) }), /长度/)
    assert.throws(() => build(qwen, { loras: Array(4).fill(loras[0]) }), /数量/)
    assert.throws(
      () => build(otherLora, { loras: [{ ...loras[0], scale: 2 }] }),
      /当前模型的 LoRA 权重/,
    )
    assert.throws(() => build(qwen, { seed: -1 }), /范围/)
    assert.equal(
      await uploadSpicyImage({
        baseURL,
        apiKey,
        bytes: image,
        contentType: 'image/png',
      }),
      'spicy://f/file-1',
    )
    assert.deepEqual(
      (
        await listModelCatalog({
          catalog: 'spicyapi-image-generation',
          baseURL,
          apiKey,
        })
      ).map((item) => item.id),
      [seedream, qwen, otherLora],
    )
    assert.ok(
      (
        await listModelCatalog({
          catalog: 'spicyapi-image-edit',
          baseURL,
          apiKey,
        })
      ).every((item) => item.id.endsWith('/edit')),
    )
    const generate = (prompt: string, timeoutMs = 1000) =>
      generateSpicyImage({
        baseURL,
        apiKey,
        body: build(qwen, { prompt }),
        onPrepared: async () => {},
        onSubmitted: async () => {},
        timeoutMs,
        pollIntervalMs: 1,
      })
    assert.equal((await generate('retry')).cost, 0.03)
    assert.equal((await generate('unsettled')).cost, undefined)
    await assert.rejects(generate('denied'), /bad weights/)
    await assert.rejects(generate('unknown'), /未知任务状态/)
    await assert.rejects(generate('no-output'), /未返回可下载/)
    await assert.rejects(generate('timeout', 5), /查询超时/)
    const before = requests.filter((item) =>
      item.url.endsWith('/jobs/createTask'),
    ).length
    await assert.rejects(generate('submit-fails'), /幂等键.*No funds/)
    assert.equal(
      requests.filter((item) => item.url.endsWith('/jobs/createTask')).length,
      before + 1,
    )
    const endpoint = {
      id: 'spicy',
      name: 'SpicyAPI',
      baseURL,
      model: qwen,
      editModel: qwen.replace('/text-to-image', '/edit'),
      apiKey,
      engine: 'spicyapi-images' as const,
      type: 'custom' as const,
      balanceEnabled: true,
      balanceApiPath: '/chat/credit',
      balanceResultJsonKey: 'data.available',
      spicyLoras: loras,
      spicySeed: 7,
      spicyResolution: '1.5k' as const,
    }
    updateConfig({ endpoints: [endpoint] })
    assert.deepEqual(getConfig().endpoints[0].spicyLoras, loras)
    const quota: any = await (
      await gptImageApi.request('/quota?endpointId=spicy')
    ).json()
    assert.equal(quota.data.data.total_available, 12.5)
    await fs.mkdir(INPUT_IMAGES_DIR, { recursive: true })
    await fs.writeFile(path.join(INPUT_IMAGES_DIR, 'reference.png'), image)
    const template = {
      id: 'test',
      title: 'test',
      prompt: 'edit',
      images: ['/api/static/input/reference.png'],
      n: 1,
      aspectRatio: '3:4',
      createdAt: Date.now(),
      usageType: 'image' as const,
    }
    const edited = await handleSpicyImageGeneration({
      ...endpoint,
      template,
      size: '2k',
      quality: 'high',
    })
    assert.equal(edited.data.success, true)
    const task = edited.data.success
      ? (await taskManager.getTasks()).find(
          (item) => item.id === edited.data.taskId,
        )
      : undefined
    assert.equal(task?.source, endpoint.editModel)
    assert.equal(task?.imageBilling?.cost, 0.03)
    assert.ok(
      task?.imageBilling?.requestIds?.some((id) =>
        id.startsWith('idempotency:'),
      ),
    )
    const lastJob = [...jobs.values()].at(-1)
    assert.deepEqual(lastJob.input.image_urls, ['spicy://f/file-1'])
    assert.equal(lastJob.input.resolution, '1.5k')
    assert.equal(lastJob.input.seed, 7)
    assert.equal(lastJob.input.quality, undefined)
    assert.ok((await fs.readdir(GENERATED_IMAGES_DIR)).length)
    const partial = await handleSpicyImageGeneration({
      ...endpoint,
      template: { ...template, prompt: 'partial', images: [], n: 2 },
      size: '1k',
      quality: 'medium',
    })
    assert.equal(partial.data.success, true)
    const partialTask = partial.data.success
      ? (await taskManager.getTasks()).find(
          (item) => item.id === partial.data.taskId,
        )
      : undefined
    assert.equal(partialTask?.outputUrls.length, 1)
    assert.match(partialTask?.error || '', /部分生成失败/)
    assert.equal(partialTask?.imageBilling?.status, 'unavailable')
    // Both public generation routes dispatch to the native SpicyAPI handler.
    const trial: any = await (
      await gptImageApi.request('/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId: endpoint.id,
          prompt: 'trial',
          aspectRatio: '3:4',
          n: 1,
          size: '2k',
          quality: 'high',
        }),
      })
    ).json()
    assert.equal(trial.success, true)
    const saved = await templateManager.addTemplate({
      ...template,
      images: [],
      prompt: 'saved',
    })
    const regular: any = await (
      await gptImageApi.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId: endpoint.id,
          templateId: saved.id,
          size: '2k',
          quality: 'high',
        }),
      })
    ).json()
    assert.equal(regular.success, true)
    const singleRecord = structuredClone(
      records.get(otherLora.replace('/text-to-image', '/edit')),
    )
    delete singleRecord.inputSchema.properties.image_urls
    singleRecord.inputSchema.properties.image_url = { type: 'string' }
    singleRecord.inputSchema.required = ['prompt', 'image_url']
    assert.equal(
      build(otherLora, { record: singleRecord, images: ['ref'] }).input
        .image_url,
      'ref',
    )
    assert.throws(
      () => build(otherLora, { record: singleRecord, images: ['ref', 'ref2'] }),
      /只接受 1 张参考图/,
    )

    console.log(
      'SpicyAPI checks passed: schema validation, all LoRA IDs, upload/commit, catalogs, idempotency, polling, billing, persistence, config, trial and saved-template routes',
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = originalDataDir
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
