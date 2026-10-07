import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-gemini-'))
  process.env.DATA_DIR = directory
  process.env.PORT = '0'
  process.env.NODE_ENV = 'development'
  process.env.OPEN_BROWSER = 'false'
  const originalFetch = globalThis.fetch
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  )
  const calls: Array<{ url: URL; body?: any; headers: Headers }> = []
  let partialCalls = 0
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    assert.equal(url.hostname, 'generativelanguage.googleapis.com', 'Unexpected external request')
    assert.equal(request.headers.get('x-goog-api-key'), 'test-key')
    assert.equal(request.headers.get('authorization'), null)
    assert.equal(url.searchParams.has('key'), false)
    assert.equal(init.redirect, 'error')
    const raw = await request.text()
    const body = raw ? JSON.parse(raw) : undefined
    calls.push({ url, body, headers: request.headers })
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
      status, headers: { 'Content-Type': 'application/json' },
    })
    if (url.pathname.endsWith('/models')) {
      if (!url.searchParams.has('pageToken')) return json({
        models: [
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-nano-banana-2.1', displayName: 'Nano Banana 2.1', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-future-image', supportedGenerationMethods: ['embedContent'] },
        ], nextPageToken: 'page + 2',
      })
      assert.equal(url.searchParams.get('pageToken'), 'page + 2')
      return json({ models: [
        { name: 'models/gemini-nano-banana-2.1', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3-pro-image-preview', supportedGenerationMethods: ['generateContent'] },
      ] })
    }
    assert.match(url.pathname, /^\/v1(?:beta)?\/models\/gemini-[\w.-]+:generateContent$/)
    const prompt = body.contents[0].parts[0].text
    if (prompt === 'quota') return json({ error: { message: 'Quota denied: test-key', status: 'RESOURCE_EXHAUSTED' } }, 429)
    if (prompt === 'partial' && ++partialCalls === 2) return json({ error: { message: 'Temporary upstream failure' } }, 503)
    if (prompt === 'blocked') return json({ promptFeedback: { blockReason: 'IMAGE_SAFETY' } })
    if (prompt === 'text-only') return json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'No image' }] } }] })
    if (prompt === 'bad-json') return new Response('bad-json', { status: 200 })
    if (prompt === 'disconnect') throw new Error('Mock connection lost after submission')
    return json({
      candidates: [{ finishReason: 'STOP', content: { parts: [
        { thought: true, inlineData: { mimeType: 'image/png', data: 'invalid-thought-preview' } },
        { inlineData: { mimeType: 'image/png', data: image.toString('base64') } },
      ] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20, thoughtsTokenCount: 3, totalTokenCount: 35 },
      responseId: 'mock-response-id',
    })
  }) as typeof fetch
  try {
    // The full app is needed for config's circular BACKEND_PORT import; PORT=0 isolates its listener.
    const { default: app } = await import('../src/server')
    const { getConfig, updateConfig } = await import('../src/server/common/config')
    const { INPUT_IMAGES_DIR, GENERATED_IMAGES_DIR } = await import('../src/server/common/static')
    const { templateManager } = await import('../src/server/common/template-manager')
    const { taskManager } = await import('../src/server/common/task-manager')
    const { buildGeminiImageRequest, extractGeminiImageBuffers } = await import('../src/server/module/gpt-image/gemini-api')
    const { GEMINI_BASE_URL, geminiApiBaseURL, GEMINI_SAFETY_THRESHOLDS } = await import('../src/shared/gemini')
    const endpoint = {
      id: 'gemini', name: 'Google Gemini', baseURL: GEMINI_BASE_URL,
      model: 'gemini-nano-banana-2.1', apiKey: 'test-key', type: 'custom' as const,
      engine: 'gemini-images' as const, balanceEnabled: false,
    }
    const post = async (route: string, body: unknown) => {
      const response = await app.request(route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      return { status: response.status, data: await response.json() as any }
    }
    assert.equal((await post('/api/config', { endpoints: [endpoint] })).status, 200)
    assert.equal(getConfig().endpoints[0].engine, 'gemini-images')
    const diskConfig = JSON.parse(await fs.readFile(path.join(directory, 'config.json'), 'utf8'))
    assert.equal(diskConfig.endpoints[0].engine, 'gemini-images')
    const catalogRequest = { catalog: 'gemini-image', baseURL: GEMINI_BASE_URL, apiKey: 'test-key' }
    const catalog = await post('/api/model-catalog/models', catalogRequest)
    assert.equal(catalog.status, 200)
    assert.deepEqual(catalog.data.data.map((item: any) => item.id), ['gemini-nano-banana-2.1', 'gemini-3-pro-image-preview'])
    const afterCatalog = calls.length
    await post('/api/model-catalog/models', catalogRequest)
    assert.equal(calls.length, afterCatalog, 'Catalog should be cached')
    const trial = (extra: Record<string, unknown> = {}) => post('/api/gptImage/trial', {
      endpointId: endpoint.id, prompt: 'mock', size: '2k', aspectRatio: '16:9', ...extra,
    })
    const generated = await trial({ n: 2, title: 'Gemini test' })
    assert.equal(generated.status, 200)
    assert.equal(generated.data.outputUrls.length, 2)
    assert.equal(calls.length - afterCatalog, 2)
    assert.deepEqual(calls.at(-1)!.body.generationConfig, {
      responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
    })
    assert.equal(calls.at(-1)!.body.quality, undefined)
    assert.equal(calls.at(-1)!.body.moderation, undefined)
    assert.equal(calls.at(-1)!.body.n, undefined)
    assert.equal(calls.at(-1)!.body.safetySettings, undefined, 'Old endpoints must use model defaults')
    assert.equal(generated.data.usage.total_tokens, 70)
    assert.equal(generated.data.usage.output_tokens, 46)
    const generatedTask = (await taskManager.getTasks()).find(task => task.id === generated.data.taskId)!
    assert.equal(generatedTask.providerQuality, 'auto')
    assert.equal(generatedTask.gptTokenUsage.total_tokens, 70)
    assert.equal(generatedTask.usage, undefined, 'Persist usage under the field used by task metrics')
    assert.equal(generatedTask.imageBilling?.status, 'unavailable')
    const filename = path.basename(generated.data.outputUrls[0])
    assert.ok((await fs.readFile(path.join(GENERATED_IMAGES_DIR, filename))).includes(Buffer.from('gemini-images')))
    const safetySettings = {
      HARM_CATEGORY_HARASSMENT: 'BLOCK_ONLY_HIGH',
      HARM_CATEGORY_HATE_SPEECH: 'BLOCK_MEDIUM_AND_ABOVE',
      HARM_CATEGORY_SEXUALLY_EXPLICIT: 'OFF',
      // Dangerous content is omitted to keep its model default.
    } as const
    assert.equal((await post('/api/config', {
      endpoints: [{ ...endpoint, geminiSafetySettings: safetySettings }],
    })).status, 200)
    assert.deepEqual(getConfig().endpoints[0].geminiSafetySettings, safetySettings)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'config.json'), 'utf8')).endpoints[0].geminiSafetySettings, safetySettings)
    const configRead = await (await app.request('/api/config')).json() as any
    assert.deepEqual(configRead.data.endpoints[0].geminiSafetySettings, safetySettings)
    assert.equal((await trial()).status, 200)
    const expectedSafety = Object.entries(safetySettings).map(([category, threshold]) => ({ category, threshold }))
    assert.deepEqual(calls.at(-1)!.body.safetySettings, expectedSafety)
    assert.equal(calls.at(-1)!.body.generationConfig.safetySettings, undefined)
    const beforeInvalidSafety = calls.length
    for (const invalid of [
      { HARM_CATEGORY_HARASSMENT: 'bad-value' },
      { UNKNOWN_CATEGORY: 'OFF' },
      { HARM_CATEGORY_HARASSMENT: null },
    ]) {
      assert.equal((await post('/api/config', {
        endpoints: [{ ...endpoint, geminiSafetySettings: invalid }],
      })).status, 400)
      assert.deepEqual(getConfig().endpoints[0].geminiSafetySettings, safetySettings)
    }
    assert.equal(calls.length, beforeInvalidSafety)
    for (const threshold of GEMINI_SAFETY_THRESHOLDS) {
      const request = await buildGeminiImageRequest({
        ...endpoint, prompt: 'mock', aspectRatio: '1:1', size: '1k', imagePaths: [],
        geminiSafetySettings: { HARM_CATEGORY_HARASSMENT: threshold },
      })
      assert.deepEqual(request.body.safetySettings, [{ category: 'HARM_CATEGORY_HARASSMENT', threshold }])
    }
    await assert.rejects(buildGeminiImageRequest({
      ...endpoint, prompt: 'mock', aspectRatio: '1:1', size: '1k', imagePaths: [],
      geminiSafetySettings: { HARM_CATEGORY_HARASSMENT: 'invalid' } as any,
    }), /安全过滤设置无效/)
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { GeminiEndpointSettings, GeminiBalanceHelp } = await import('../src/client/pages/common/SettingModal/GeminiEndpointSettings')
    const settingsHtml = renderToStaticMarkup(createElement(GeminiEndpointSettings, {
      endpoint: { ...endpoint, geminiSafetySettings: safetySettings }, onChange: () => {},
    }))
    for (const label of ['骚扰攻击', '仇恨歧视', '色情露骨', '危险行为', '宽松（较少拦截）', '适中（部分拦截）', '关闭额外过滤', '默认（由模型决定）', '全部恢复默认过滤'])
      assert.ok(settingsHtml.includes(label), `Missing readable setting: ${label}`)
    assert.ok(settingsHtml.includes('只有模型认为内容很可能违规时'))
    const balanceHtml = renderToStaticMarkup(createElement(GeminiBalanceHelp))
    assert.ok(balanceHtml.includes('https://aistudio.google.com/billing'))
    assert.ok(balanceHtml.includes('当前无法仅凭 Gemini API Key'))
    assert.ok(balanceHtml.includes('noopener noreferrer'))
    const { TaskItemMetrics } = await import('../src/client/pages/common/TaskList/components/TaskItemTags')
    const metricsHtml = renderToStaticMarkup(createElement(TaskItemMetrics, { task: generatedTask, showDuration: false }))
    assert.ok(metricsHtml.includes('用量:'))
    assert.ok(metricsHtml.includes('70'))
    assert.ok(metricsHtml.includes('Token'))
    assert.ok(!metricsHtml.includes('$'), 'Usage is not a dollar bill')
    const legacyMetricsHtml = renderToStaticMarkup(createElement(TaskItemMetrics, {
      task: { ...generatedTask, gptTokenUsage: undefined, usage: generatedTask.gptTokenUsage }, showDuration: false,
    }))
    assert.ok(legacyMetricsHtml.includes('70'), 'Previously generated Gemini task usage remains visible')
    const noUsageHtml = renderToStaticMarkup(createElement(TaskItemMetrics, {
      task: { ...generatedTask, gptTokenUsage: undefined }, showDuration: false,
    }))
    assert.equal(noUsageHtml, '', 'Missing upstream usage must not display a fabricated zero')
    const reference = path.join(INPUT_IMAGES_DIR, 'reference.png')
    await fs.writeFile(reference, image)
    updateConfig({ endpoints: [{ ...endpoint, editModel: 'gemini-3-pro-image-preview', geminiSafetySettings: safetySettings }] })
    const template = await templateManager.addTemplate({
      prompt: 'mock', images: ['/api/static/input/reference.png'], usageType: 'image',
      aspectRatio: 'auto', injectAspectRatio: false, n: 1,
    })
    const edited = await post('/api/gptImage/generate', {
      endpointId: endpoint.id, templateId: template.id, size: '4k', quality: 'high',
    })
    assert.equal(edited.status, 200)
    assert.equal(calls.at(-1)!.url.pathname, '/v1beta/models/gemini-3-pro-image-preview:generateContent')
    assert.deepEqual(calls.at(-1)!.body.generationConfig.imageConfig, { imageSize: '4K' })
    assert.deepEqual(calls.at(-1)!.body.safetySettings, expectedSafety)
    assert.deepEqual(calls.at(-1)!.body.contents[0].parts[1].inlineData, {
      mimeType: 'image/png', data: image.toString('base64'),
    })
    let before = calls.length
    updateConfig({ endpoints: [{ ...endpoint, disabled: true }] })
    assert.equal((await trial()).status, 400)
    assert.equal((await post('/api/gptImage/generate', { endpointId: endpoint.id, templateId: template.id })).status, 400)
    assert.equal(calls.length, before)
    updateConfig({ endpoints: [{ ...endpoint, model: 'gemini-2.5-flash-image' }] })
    assert.equal((await trial({ size: '2k' })).status, 400)
    assert.equal(calls.length, before)
    assert.equal((await trial({ size: '1k', images: Array(4).fill('/api/static/input/reference.png') })).status, 400)
    assert.equal((await trial({ size: '1k' })).status, 200)
    assert.equal(calls.at(-1)!.body.generationConfig.imageConfig.imageSize, undefined)
    assert.equal((await post('/api/config', { endpoints: [endpoint] })).status, 200)
    assert.equal(getConfig().endpoints[0].geminiSafetySettings, undefined)
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'config.json'), 'utf8')).endpoints[0].geminiSafetySettings, undefined)
    assert.equal((await trial()).status, 200)
    assert.equal(calls.at(-1)!.body.safetySettings, undefined, 'Reset must omit safetySettings')
    for (const extra of [{ aspectRatio: '2:1' }, { n: 1.5 }, { images: ['/api/static/input/missing.png'] }]) {
      before = calls.length
      assert.equal((await trial(extra)).status, 400)
      assert.equal(calls.length, before, 'Invalid request must not submit a paid call')
    }
    for (const [prompt, status, reason] of [
      ['quota', 429, 'Quota denied'], ['blocked', 502, 'IMAGE_SAFETY'],
      ['text-only', 502, 'STOP'], ['bad-json', 502, '无法解析'], ['disconnect', 500, 'connection lost'],
    ] as const) {
      before = calls.length
      const failure = await trial({ prompt })
      assert.equal(failure.status, status)
      assert.match(failure.data.error, new RegExp(reason))
      assert.equal(failure.data.error.includes('test-key'), false)
      assert.equal(calls.length - before, 1, 'Paid call must not retry')
    }
    before = calls.length
    const partial = await trial({ prompt: 'partial', n: 3, writeMetadata: false })
    assert.equal(partial.status, 200)
    assert.equal(partial.data.outputUrls.length, 2)
    assert.equal(calls.length - before, 3)
    const partialTask = (await taskManager.getTasks()).find(task => task.id === partial.data.taskId)!
    assert.match(partialTask.error!, /部分生成失败 \(1\/3\)/)
    assert.equal(partialTask.status, 'completed')
    assert.equal(partial.data.usage.total_tokens, 70)
    assert.equal(partialTask.gptTokenUsage.total_tokens, 70)
    assert.deepEqual(extractGeminiImageBuffers({ candidates: [{ content: { parts: [
      { inline_data: { mime_type: 'image/png', data: image.toString('base64') } },
    ] } }] }), [image])
    assert.throws(() => extractGeminiImageBuffers({ candidates: [{
      finishReason: 'SAFETY', safetyRatings: [{ category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', blocked: true }],
      content: { parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] },
    }] }), /安全检查拦截.*色情露骨/)
    assert.throws(() => extractGeminiImageBuffers({ candidates: {} }), /Gemini 未返回图片/)
    assert.equal(geminiApiBaseURL('https://generativelanguage.googleapis.com'), GEMINI_BASE_URL)
    assert.equal(geminiApiBaseURL(`${GEMINI_BASE_URL}/openai/`), GEMINI_BASE_URL)
    assert.equal(geminiApiBaseURL('https://generativelanguage.googleapis.com/v1'), 'https://generativelanguage.googleapis.com/v1')
    assert.throws(() => geminiApiBaseURL(`${GEMINI_BASE_URL}?key=should-not-leak`))
    await fs.writeFile(path.join(INPUT_IMAGES_DIR, 'reference.gif'), image)
    before = calls.length
    assert.equal((await trial({ images: ['/api/static/input/reference.gif'] })).status, 400)
    assert.equal(calls.length, before)
    const oversized = path.join(INPUT_IMAGES_DIR, 'oversized.png')
    const largeFile = await fs.open(oversized, 'w')
    await largeFile.truncate(16 * 1000 * 1000)
    await largeFile.close()
    const tooLarge = await trial({ images: ['/api/static/input/oversized.png'] })
    assert.equal(tooLarge.status, 400)
    assert.match(tooLarge.data.error, /20 MB/)
    assert.equal(calls.length, before)
    assert.throws(() => extractGeminiImageBuffers({ candidates: [{ content: { parts: [
      { inlineData: { mimeType: 'image/png', data: 'invalid' } },
    ] } }] }), /图片/)
    await assert.rejects(buildGeminiImageRequest({
      ...endpoint, prompt: 'mock', size: '2k', aspectRatio: '1:1', imagePaths: [], model: 'gemini-3.1-flash-lite-image',
    }), /仅支持 1K/)
    console.log('Gemini offline integration checks passed: safety persistence/reset/validation, readable settings and billing link, paginated catalog, both generation routes, native references/resolutions, metadata, usage, disabled endpoints, partial batches, safety errors and no retries.')
  } finally {
    globalThis.fetch = originalFetch
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('linai-gemini-'))
    await fs.rm(directory, { recursive: true, force: true })
  }
}
// The imported application owns an ephemeral listener, so always close the test process.
main().then(() => process.exit(0)).catch(error => {
  console.error(error)
  process.exit(1)
})
