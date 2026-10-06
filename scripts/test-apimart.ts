import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-apimart-'))
  const originalDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = directory
  const originalFetch = globalThis.fetch
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  )
  const submissions: Record<string, any>[] = []
  const submittedTasks = new Map<string, Record<string, any>>()
  const polls = new Map<string, number>()
  let unlimitedBalance = false
  let wrappedChat = true
  let invalidChat = false
  const catalog = [
    {
      id: 'gpt-image-2',
      category: 'image',
      capability_tags: ['Text to Image', 'Image to Image'],
      supported_endpoint_types: ['openai'],
    },
    {
      id: 'custom-image',
      category: 'image',
      capability_tags: ['Text to Image'],
      supported_endpoint_types: ['openai'],
      parameters: {
        operation: 'image_generation',
        method: 'POST',
        endpoint: '/v1/images/generations',
        input_schema: {
          properties: {
            prompt: {},
            size: { enum: ['1:1'] },
            resolution: { enum: ['1K', '2K'] },
          },
        },
      },
    },
    {
      id: 'custom-vision',
      category: 'chat',
      capability_tags: ['Text', 'Vision'],
      supported_endpoint_types: ['openai'],
    },
    {
      id: 'custom-text',
      category: 'chat',
      capability_tags: ['Text'],
      supported_endpoint_types: ['openai'],
    },
    {
      id: 'gpt-image-video-decoy',
      category: 'video',
      capability_tags: ['Text to Video'],
      supported_endpoint_types: ['openai'],
    },
  ]
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : {}
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (req.url?.startsWith('/v1/'))
      assert.equal(req.headers.authorization, 'Bearer test-key')
    if (req.url === '/v1/images/generations') {
      submissions.push(body)
      if (body.prompt === 'submission-failure')
        return json({ error: { message: 'No balance' } }, 402)
      const id = `task_${submissions.length}`
      submittedTasks.set(id, body)
      return json({ code: 200, data: [{ status: 'submitted', task_id: id }] })
    }
    if (req.url?.startsWith('/v1/tasks/')) {
      const id = req.url.split('/').pop()!
      const count = (polls.get(id) || 0) + 1
      polls.set(id, count)
      const prompt = submittedTasks.get(id)?.prompt
      if (prompt === 'timeout')
        return json({ code: 200, data: { status: 'processing' } })
      if (prompt === 'retry' && count === 1)
        return json({ error: { message: 'busy' } }, 503)
      if (prompt === 'denied')
        return json({ error: { message: 'denied' } }, 401)
      if (prompt === 'pending' && count === 1)
        return json({ code: 200, data: { status: 'pending' } })
      if (
        prompt === 'failed' ||
        (prompt === 'partial' && Number(id.split('_')[1]) % 2 === 0)
      )
        return json({
          code: 200,
          data: {
            status: 'failed',
            error: { message: 'mock generation failed' },
          },
        })
      if (prompt === 'empty')
        return json({
          code: 200,
          data: { status: 'completed', result: { images: [] } },
        })
      return json({
        code: 200,
        data: {
          status: 'completed',
          cost: 0.15,
          result: { images: [{ url: ['https://api.apimart.ai/image.png'] }] },
        },
      })
    }
    if (req.url === '/image.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(image)
    }
    if (req.url?.startsWith('/v1/models?expand='))
      return json({ object: 'list', data: catalog })
    if (req.url === '/v1/chat/completions') {
      assert.equal(body.stream, false)
      if (invalidChat)
        return json({ code: 402, error: { message: 'Insufficient balance' } })
      const completion = { choices: [{ message: { content: 'compatible' } }] }
      return json(wrappedChat ? { code: 200, data: completion } : completion)
    }
    if (req.url === '/v1/balance')
      return json({
        success: true,
        remain_balance: unlimitedBalance ? -1 : 12.5,
        used_balance: 2.5,
        unlimited_quota: unlimitedBalance,
      })
    return json({ error: { message: `Unexpected route ${req.url}` } }, 404)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    assert.equal(
      url.hostname,
      'api.apimart.ai',
      `Unexpected network call: ${url}`,
    )
    // The provider hostname remains in application options; network stays local.
    return originalFetch(
      `http://127.0.0.1:${port}${url.pathname}${url.search}`,
      init,
    )
  }) as typeof fetch
  try {
    const { Hono } = await import('hono')
    const { default: imageApi } = await import('../src/server/api/gpt-image')
    const { default: chatApi } = await import('../src/server/api/chat')
    const { updateConfig } = await import('../src/server/common/config')
    const { taskManager } = await import('../src/server/common/task-manager')
    const { templateManager } =
      await import('../src/server/common/template-manager')
    const { buildAPIMartImageBody, generateAPIMartImage } =
      await import('../src/server/module/gpt-image/apimart-api')
    const { createChatCompletion } = await import('../src/server/module/chat')
    const { listModelCatalog } =
      await import('../src/server/module/model-catalog')
    const endpoint = {
      id: 'apimart-test',
      name: 'APImart test',
      baseURL: 'https://api.apimart.ai/v1',
      apiKey: 'test-key',
      model: 'gpt-image-2',
      editModel: 'gemini-3.1-flash-image-preview',
      type: 'custom' as const,
      engine: 'apimart-images' as const,
      balanceEnabled: true,
      balanceApiPath: '/balance',
      balanceResultJsonKey: 'remain_balance',
    }
    updateConfig({
      endpoints: [endpoint],
      llmEndpoints: [{ ...endpoint, id: 'apimart-llm', model: 'gpt-5' }],
    })
    const app = new Hono().route('/image', imageApi).route('/chat', chatApi)
    const trial = async (prompt: string, n = 1, images: string[] = []) => {
      const response = await app.request('/image/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId: endpoint.id,
          prompt,
          aspectRatio: '16:9',
          size: '2k',
          quality: 'high',
          n,
          images,
        }),
      })
      return { status: response.status, data: (await response.json()) as any }
    }
    const generated = await trial('generation', 2)
    assert.equal(generated.status, 200)
    assert.equal(generated.data.outputUrls.length, 2)
    for (const submission of submissions) {
      assert.equal(submission.n, 1)
      assert.equal(submission.size, '16:9')
      assert.equal(submission.resolution, '2k')
      assert.equal(submission.quality, undefined)
    }
    const generationTask = (await taskManager.getTasks()).find(
      (task) => task.id === generated.data.taskId,
    )!
    assert.equal(generationTask.status, 'completed')
    assert.equal(generationTask.imageBilling?.cost, 0.3)
    assert.equal(generationTask.imageBilling?.requestIds.length, 2)
    await fs.access(
      path.join(
        directory,
        'images',
        'generated',
        path.basename(generated.data.outputUrls[0]),
      ),
    )

    await fs.writeFile(
      path.join(directory, 'images', 'input', 'reference.png'),
      image,
    )
    const edited = await trial('edit', 1, [
      '/api/static/images/input/reference.png',
    ])
    assert.equal(edited.status, 200)
    assert.equal(submissions.at(-1)?.model, endpoint.editModel)
    assert.equal(submissions.at(-1)?.resolution, '2K')
    assert.match(submissions.at(-1)?.image_urls[0], /^data:image\/png;base64,/)
    const beforeMissingReference = submissions.length
    assert.equal(
      (await trial('missing', 1, ['/api/static/images/input/missing.png']))
        .status,
      500,
    )
    assert.equal(submissions.length, beforeMissingReference)
    const saved = await templateManager.addTemplate({
      prompt: 'saved',
      title: 'Saved',
      images: [],
      aspectRatio: '1:1',
      n: 1,
      usageType: 'image',
    })
    const regular = await app.request('/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: saved.id,
        endpointId: endpoint.id,
        size: '1k',
        quality: 'medium',
        writeMetadata: false,
      }),
    })
    assert.equal(regular.status, 200)

    const beforePartial = submissions.length
    const partial = await trial('partial', 2)
    assert.equal(partial.status, 200)
    assert.equal(submissions.length - beforePartial, 2)
    assert.equal(partial.data.outputUrls.length, 1)
    const partialTask = (await taskManager.getTasks()).find(
      (task) => task.id === partial.data.taskId,
    )!
    assert.match(partialTask.error!, /部分生成失败/)
    assert.equal(partialTask.imageBilling?.status, 'unavailable')
    assert.equal((await trial('failed')).status, 500)
    assert.equal((await trial('empty')).status, 500)
    const beforeFailure = submissions.length
    assert.equal((await trial('submission-failure')).status, 500)
    assert.equal(
      submissions.length,
      beforeFailure + 1,
      'Paid submissions must never be retried',
    )

    const protocol = {
      apiKey: endpoint.apiKey,
      baseURL: endpoint.baseURL,
      onSubmitted: async () => {},
      pollIntervalMs: 1,
      timeoutMs: 1000,
    }
    const retried = await generateAPIMartImage({
      ...protocol,
      body: { prompt: 'retry' },
    })
    assert.equal(polls.get(retried.taskId), 2)
    const pending = await generateAPIMartImage({
      ...protocol,
      body: { prompt: 'pending' },
    })
    assert.equal(polls.get(pending.taskId), 2)
    await assert.rejects(
      generateAPIMartImage({ ...protocol, body: { prompt: 'denied' } }),
      /查询失败.*denied/,
    )
    await assert.rejects(
      generateAPIMartImage({
        ...protocol,
        timeoutMs: 15,
        body: { prompt: 'timeout' },
      }),
      /task_.*查询超时/,
    )
    const bodyOptions = {
      ...endpoint,
      prompt: 'schema',
      aspectRatio: '1:1',
      size: '2k' as const,
      quality: 'medium' as const,
      images: [] as string[],
    }
    assert.equal(
      (await buildAPIMartImageBody({ ...bodyOptions, model: 'custom-image' }))
        .resolution,
      '2K',
    )
    await assert.rejects(
      buildAPIMartImageBody({ ...bodyOptions, aspectRatio: '7:3' }),
      /不支持比例/,
    )
    await assert.rejects(
      buildAPIMartImageBody({
        ...bodyOptions,
        images: Array(16).fill('data:image/png;base64,AA=='),
      }),
      /最多接受/,
    )
    await assert.rejects(
      buildAPIMartImageBody({ ...bodyOptions, model: 'custom-text' }),
      /未声明兼容/,
    )

    for (const catalogType of [
      'openai-image-generation',
      'openai-image-edit',
      'openai-vision-text',
      'openai',
    ] as const) {
      const models = await listModelCatalog({
        catalog: catalogType,
        ...endpoint,
      })
      assert.deepEqual(
        models.map((model) => model.id),
        catalogType === 'openai-image-generation'
          ? ['gpt-image-2', 'custom-image']
          : catalogType === 'openai-image-edit'
            ? ['gpt-image-2']
            : catalogType === 'openai-vision-text'
              ? ['custom-vision']
              : ['custom-vision', 'custom-text'],
      )
    }
    for (wrappedChat of [true, false]) {
      const completion = await createChatCompletion({
        ...endpoint,
        body: { model: 'gpt-5', messages: [{ role: 'user', content: 'test' }] },
      })
      assert.equal(
        (completion.data as any).choices[0].message.content,
        'compatible',
      )
      const routed = await app.request('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId: 'apimart-llm',
          messages: [{ role: 'user', content: 'test' }],
        }),
      })
      assert.equal(routed.status, 200)
      assert.equal(
        ((await routed.json()) as any).choices[0].message.content,
        'compatible',
      )
    }
    invalidChat = true
    const invalid = await createChatCompletion({
      ...endpoint,
      body: { model: 'gpt-5', messages: [] },
    })
    assert.equal(invalid.status, 402)
    assert.match((invalid.data as any).error, /Insufficient balance/)
    for (unlimitedBalance of [false, true]) {
      const quota = await app.request('/image/quota?endpointId=apimart-test')
      const quotaData = ((await quota.json()) as any).data.data
      assert.equal(quotaData.unlimited_quota, unlimitedBalance)
      assert.equal(quotaData.total_available, unlimitedBalance ? 0 : 12.5)
      assert.equal(quotaData.total_granted, unlimitedBalance ? 0 : 15)
      assert.equal(quotaData.total_used, 2.5)
    }
    console.log(
      'APImart passed: trial and saved-template routes, generation/edit/batches, partial failures, polling/errors/timeout/no resubmission, persisted images and billing, model capabilities, LLM responses, and finite/unlimited balances. Local mock only.',
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = originalDataDir
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    // Only this test-created temporary directory is removed.
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
