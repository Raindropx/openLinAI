import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-laozhang-'))
  const originalDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = directory
  const originalFetch = globalThis.fetch
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  )
  const submissions: Array<{ url: string; body: any; contentType?: string }> =
    []
  let partialAttempts = 0
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const raw = Buffer.concat(chunks).toString()
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.url === '/api/user/self') {
      assert.equal(req.headers.authorization, 'test-access-token')
      return json({
        success: true,
        data: { quota: 1500000, used_quota: 250000 },
      })
    }
    if (req.url === '/image.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(image)
    }
    assert.equal(req.headers.authorization, 'Bearer test-key')
    if (req.url === '/v1/models')
      return json({
        data: [
          'gpt-image-2-vip',
          'gemini-3.1-flash-image',
          'seedream-5-0-flash-260915',
          'flux-2-pro',
          'gpt-5.6-luna',
        ].map((id) => ({ id })),
      })
    if (req.url === '/v1/chat/completions')
      return json({ choices: [{ message: { content: 'mock text' } }] })
    const contentType = req.headers['content-type']
    const body = contentType?.startsWith('application/json')
      ? JSON.parse(raw)
      : raw
    submissions.push({ url: req.url!, body, contentType })
    if (body.prompt === 'denied')
      return json({ error: { message: 'Mock denied' } }, 401)
    if (body.prompt === 'malformed') {
      res.writeHead(200)
      return res.end('not-json')
    }
    if (body.prompt === 'partial' && ++partialAttempts === 1)
      return json({ error: { message: 'Mock failure' } }, 503)
    if (req.url?.includes(':generateContent'))
      return json({
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  inlineData: {
                    mimeType: 'image/png',
                    data: image.toString('base64'),
                  },
                },
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: image.toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      })
    if (body.model?.startsWith('seedream-'))
      return json({ data: [{ url: 'https://api.laozhang.ai/image.png' }] })
    return json({
      data: [
        {
          b64_json:
            'data:image/png;base64,' +
            image.toString('base64').replace(/=+$/, ''),
        },
      ],
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  globalThis.fetch = ((input, init) => {
    const url = new URL(String(input))
    assert.ok(
      ['api.laozhang.ai', 'api2.laozhang.ai', 'api-vip.laozhang.ai'].includes(
        url.hostname,
      ),
      `Unexpected network call: ${url}`,
    )
    return originalFetch(
      `http://127.0.0.1:${port}${url.pathname}${url.search}`,
      init,
    )
  }) as typeof fetch
  try {
    const { Hono } = await import('hono')
    const { default: imageApi } = await import('../src/server/api/gpt-image')
    const { updateConfig, getConfig } =
      await import('../src/server/common/config')
    const { taskManager } = await import('../src/server/common/task-manager')
    const getTask = async (id: string) =>
      (await taskManager.getTasks()).find((task) => task.id === id)!
    const { templateManager } =
      await import('../src/server/common/template-manager')
    const { INPUT_IMAGES_DIR, GENERATED_IMAGES_DIR } =
      await import('../src/server/common/static')
    const { decodeImageBase64 } =
      await import('../src/server/module/gpt-image/image-files')
    const {
      buildLaoZhangImageRequest,
      generateLaoZhangImage,
      extractLaoZhangImages,
      fetchLaoZhangBalance,
      laoZhangImageSize,
      laoZhangSeedreamSize,
    } = await import('../src/server/module/gpt-image/laozhang-api')
    const { clientConfig, preserveBalanceCredentials } =
      await import('../src/server/common/config/client-config')
    const { listModelCatalog } =
      await import('../src/server/module/model-catalog')
    const { usesLaoZhangImages } = await import('../src/shared/laozhang')
    const { createChatCompletion } = await import('../src/server/module/chat')
    const endpoint = {
      id: 'lao',
      name: 'LaoZhang',
      baseURL: 'https://api.laozhang.ai/v1',
      model: 'gpt-image-2-vip',
      apiKey: 'test-key',
      type: 'laozhang' as const,
      engine: 'laozhang-images' as const,
      balanceEnabled: true,
      balanceAccessToken: 'test-access-token',
    }
    const options = {
      ...endpoint,
      prompt: 'mock',
      aspectRatio: '1:1',
      size: '2k' as const,
      quality: 'medium' as const,
      imagePaths: [] as string[],
    }
    updateConfig({ endpoints: [endpoint] })
    const app = new Hono().route('/api/gptImage', imageApi)
    const chat = await createChatCompletion({
      apiKey: 'test-key',
      baseURL: 'https://api.laozhang.ai',
      body: {
        model: 'gpt-5.6-luna',
        messages: [{ role: 'user', content: 'mock' }],
      },
    })
    assert.equal((chat.data as any).choices[0].message.content, 'mock text')
    const trial = async (
      extra: Record<string, unknown> = {},
      current = endpoint,
    ) => {
      updateConfig({ endpoints: [current] })
      const response = await app.request('/api/gptImage/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId: 'lao',
          prompt: 'mock',
          size: '2k',
          quality: 'medium',
          writeMetadata: false,
          ...extra,
        }),
      })
      return (await response.json()) as any
    }
    const prefix = await trial()
    assert.deepEqual(
      decodeImageBase64(
        'data:image/png;base64,\n' +
          image.toString('base64').replace(/=+$/, ''),
      ),
      image,
    )
    assert.throws(() => decodeImageBase64('YWJj'), /可识别/)
    assert.throws(() => decodeImageBase64('x'), /Base64/)
    assert.equal(prefix.success, true)
    assert.deepEqual(
      await fs.readFile(
        path.join(GENERATED_IMAGES_DIR, path.basename(prefix.outputUrls[0])),
      ),
      image,
    )
    assert.equal(submissions.at(-1)!.url, '/v1/images/generations')
    assert.deepEqual(submissions.at(-1)!.body, {
      model: 'gpt-image-2-vip',
      prompt: 'mock',
      size: '2048x2048',
      quality: 'medium',
    })
    assert.equal(
      (await getTask(prefix.taskId)).imageBilling!.status,
      'unavailable',
    )
    const reference = path.join(INPUT_IMAGES_DIR, 'reference.png')
    await fs.writeFile(reference, image)
    const web = await trial({}, { ...endpoint, model: 'gpt-image-2.5-web' })
    assert.equal(submissions.at(-1)!.body.quality, undefined)
    assert.equal(submissions.at(-1)!.body.size, '2048x2048')
    assert.equal((await getTask(web.taskId)).providerQuality, 'auto')
    const grok = await trial(
      { aspectRatio: '16:9', quality: 'high' },
      { ...endpoint, model: 'grok-imagine-image-2.0' },
    )
    assert.deepEqual(submissions.at(-1)!.body, {
      model: 'grok-imagine-image-2.0',
      prompt: 'mock',
      aspect_ratio: '16:9',
      resolution: '2k',
      quality: 'medium',
      n: 1,
      response_format: 'b64_json',
    })
    assert.equal((await getTask(grok.taskId)).providerQuality, 'medium')
    const grokEdit = await trial(
      { images: ['/api/static/input/reference.png'] },
      { ...endpoint, model: 'grok-imagine-image-2.0' },
    )
    assert.equal(submissions.at(-1)!.url, '/v1/images/edits')
    assert.match(
      submissions.at(-1)!.body,
      /name="image"; filename="reference.png"/,
    )
    assert.doesNotMatch(
      submissions.at(-1)!.body,
      /name="(?:size|resolution|quality)"/,
    )
    assert.equal((await getTask(grokEdit.taskId)).providerQuality, 'auto')
    const grokMulti = await buildLaoZhangImageRequest({
      ...options,
      model: 'grok-imagine-image-2.0',
      imagePaths: [reference, reference, reference],
    })
    assert.equal((grokMulti.init.body as FormData).getAll('image[]').length, 3)
    for (const invalid of [
      { size: '4k' as const },
      { laozhangQuality: 'high' as const },
      { imagePaths: Array(4).fill(reference) },
      { aspectRatio: '9:21' },
    ])
      await assert.rejects(
        buildLaoZhangImageRequest({
          ...options,
          model: 'grok-imagine-image-2.0',
          ...invalid,
        }),
      )
    await trial({ images: ['/api/static/input/reference.png'] })
    assert.equal(submissions.at(-1)!.url, '/v1/images/edits')
    assert.match(
      submissions.at(-1)!.contentType!,
      /multipart\/form-data; boundary=/,
    )
    assert.match(
      submissions.at(-1)!.body,
      /name="image"; filename="reference.png"/,
    )
    const multipart = await buildLaoZhangImageRequest({
      ...options,
      imagePaths: [reference, reference],
    })
    assert.equal((multipart.init.body as FormData).getAll('image[]').length, 2)
    await trial({}, { ...endpoint, model: 'gpt-image-2' })
    assert.deepEqual(submissions.at(-1)!.body, {
      model: 'gpt-image-2',
      prompt: 'mock',
    })
    const official = await buildLaoZhangImageRequest({
      ...options,
      model: 'gpt-image-2',
      laozhangGptImage2Mode: 'official',
    })
    assert.equal(JSON.parse(official.init.body as string).size, '2048x2048')
    const transparent = await buildLaoZhangImageRequest({
      ...options,
      model: 'gpt-image-2.5-flare-vip',
      laozhangQuality: 'max',
      laozhangTransparentBackground: true,
    })
    assert.deepEqual(JSON.parse(transparent.init.body as string), {
      model: 'gpt-image-2.5-flare-vip',
      prompt: 'mock',
      size: '2048x2048',
      quality: 'max',
      background: 'transparent',
      output_format: 'png',
    })
    const gemini = await trial(
      {
        images: ['/api/static/input/reference.png'],
        aspectRatio: '16:9',
        size: '4k',
      },
      { ...endpoint, model: 'gemini-3.1-flash-image' },
    )
    assert.equal(gemini.outputUrls.length, 1)
    assert.equal(
      submissions.at(-1)!.url,
      '/v1beta/models/gemini-3.1-flash-image:generateContent',
    )
    assert.deepEqual(submissions.at(-1)!.body.generationConfig.imageConfig, {
      aspectRatio: '16:9',
      imageSize: '4K',
    })
    assert.equal(
      submissions.at(-1)!.body.contents[0].parts[1].inlineData.data,
      image.toString('base64'),
    )
    await trial(
      { images: ['/api/static/input/reference.png'] },
      { ...endpoint, model: 'seedream-5-0-flash-260915' },
    )
    assert.equal(submissions.at(-1)!.url, '/v1/images/generations')
    assert.match(submissions.at(-1)!.body.image, /^data:image\/png;base64,/)
    assert.equal(submissions.at(-1)!.body.size, '2048x2048')
    assert.equal(submissions.at(-1)!.body.quality, undefined)
    assert.equal(submissions.at(-1)!.body.stream, undefined)
    const multi = await trial({ prompt: 'partial', n: 2 })
    assert.equal(multi.success, true)
    assert.equal(multi.outputUrls.length, 1)
    assert.equal(partialAttempts, 2)
    assert.match((await getTask(multi.taskId)).error!, /部分生成失败/)
    for (const prompt of ['denied', 'malformed']) {
      const before = submissions.length
      await assert.rejects(generateLaoZhangImage({ ...options, prompt }))
      assert.equal(
        submissions.length,
        before + 1,
        'Paid requests must not retry',
      )
    }
    const before = submissions.length
    const rejected = await trial(
      { size: '4k', n: 3 },
      { ...endpoint, model: 'gemini-3.1-flash-lite-image' },
    )
    assert.equal(rejected.success, false)
    assert.equal(
      submissions.length,
      before,
      'Unsupported batch must fail before submission',
    )
    await assert.rejects(
      buildLaoZhangImageRequest({ ...options, model: 'flux-2-pro' }),
    )
    await assert.rejects(
      buildLaoZhangImageRequest({
        ...options,
        model: 'gemini-3.1-flash-image',
        imagePaths: Array(15).fill(reference),
      }),
    )
    await assert.rejects(
      buildLaoZhangImageRequest({ ...options, laozhangQuality: 'max' }),
    )
    assert.throws(() =>
      laoZhangSeedreamSize('seedream-5-0-pro-260628', '1:1', '4k'),
    )
    assert.equal(laoZhangImageSize('16:9', '4k'), '3840x2160')
    const seedDimensions = laoZhangSeedreamSize(
      'seedream-4-5-251128',
      '16:9',
      '2k',
    )
      .split('x')
      .map(Number)
    assert.ok(seedDimensions[0] * seedDimensions[1] >= 3686400)
    assert.equal(
      extractLaoZhangImages({
        candidates: [
          {
            content: {
              parts: [
                { inline_data: { mime_type: 'image/webp', data: 'YQ==' } },
              ],
            },
          },
        ],
      })[0],
      'data:image/webp;base64,YQ==',
    )
    assert.deepEqual(
      await fetchLaoZhangBalance(endpoint.baseURL, 'test-access-token'),
      { total_available: 3, total_used: 0.5, total_granted: 3.5 },
    )
    await assert.rejects(
      fetchLaoZhangBalance('https://example.com/v1', 'test-access-token'),
    )
    await assert.rejects(fetchLaoZhangBalance(endpoint.baseURL, ''))
    const masked = clientConfig(getConfig())
    assert.equal(JSON.stringify(masked).includes('test-access-token'), false)
    assert.equal(masked.endpoints[0].balanceAccessTokenConfigured, true)
    assert.equal(
      preserveBalanceCredentials(masked.endpoints, [endpoint])[0]
        .balanceAccessToken,
      'test-access-token',
    )
    assert.equal(
      preserveBalanceCredentials(
        [{ ...endpoint, balanceAccessToken: '' }],
        [endpoint],
      )[0].balanceAccessToken,
      undefined,
    )
    assert.equal(
      preserveBalanceCredentials(
        [{ ...endpoint, balanceAccessToken: ' new-token ' }],
        [endpoint],
      )[0].balanceAccessToken,
      'new-token',
    )
    updateConfig({ endpoints: [endpoint] })
    const quota = await app.request('/api/gptImage/quota?endpointId=lao')
    assert.equal(((await quota.json()) as any).data.data.total_available, 3)
    const models = await listModelCatalog({
      ...endpoint,
      catalog: 'laozhang-image',
    })
    assert.deepEqual(
      models.map((model) => model.id),
      [
        'gpt-image-2-vip',
        'gemini-3.1-flash-image',
        'seedream-5-0-flash-260915',
      ],
    )
    assert.equal(
      usesLaoZhangImages({ ...endpoint, engine: 'chat-completions' }),
      true,
    )
    // The saved-template generation route must use the same adapter as trial.
    const template = await templateManager.addTemplate({
      title: 'mock',
      prompt: 'mock',
      images: [],
      aspectRatio: '1:1',
      usageType: 'image',
      n: 1,
    })
    updateConfig({ endpoints: [endpoint] })
    const generated = await app.request('/api/gptImage/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpointId: 'lao',
        templateId: template.id,
        size: '2k',
        quality: 'medium',
        writeMetadata: false,
      }),
    })
    assert.equal(((await generated.json()) as any).success, true)
    console.log(
      'LaoZhang offline integration checks passed: native requests, multipart edits, image saving, partial batches, no retries, balance, credentials, catalog and both generation routes.',
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = originalDataDir
    await new Promise<void>((resolve) => server.close(() => resolve()))
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    )
    assert.ok(path.basename(directory).startsWith('linai-laozhang-'))
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
