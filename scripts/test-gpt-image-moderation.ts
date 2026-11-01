import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { GptImageModeration } from '../src/server/module/gpt-image/enum'
import { showGptImageModeration } from '../src/shared/gpt-image'

async function main() {
  // Match visibility to the adapter that will actually handle the endpoint.
  const endpointForVisibility = {
    baseURL: 'https://example.invalid/v1',
    model: 'gpt-image-2',
  }
  for (const engine of [
    undefined,
    'openai-images',
    'laozhang-images',
    'openrouter-images',
    'venice-images',
    'novelai-images',
    'apimart-images',
    'spicyapi-images',
    'gemini-images',
    'chat-completions',
  ]) {
    assert.equal(
      showGptImageModeration({ ...endpointForVisibility, engine }),
      [undefined, 'openai-images', 'laozhang-images'].includes(engine),
      `Visibility for ${engine}`,
    )
  }
  assert.equal(
    showGptImageModeration({
      ...endpointForVisibility,
      baseURL: 'https://api.laozhang.ai/v1',
      engine: 'chat-completions',
    }),
    true,
    'Legacy LaoZhang endpoints use the native adapter',
  )
  assert.equal(
    showGptImageModeration({
      ...endpointForVisibility,
      engine: 'laozhang-images',
      model: 'gemini-3.1-flash-image',
    }),
    false,
  )
  assert.equal(
    showGptImageModeration({
      ...endpointForVisibility,
      engine: 'laozhang-images',
      model: 'gemini-3.1-flash-image',
      editModel: 'gpt-image-2-vip',
    }),
    true,
  )
  for (const model of [
    'gpt-image-1-official',
    'gpt-image-1.5-official',
    'gpt-image-2-official',
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst',
  ])
    assert.equal(
      showGptImageModeration({
        ...endpointForVisibility,
        engine: 'apimart-images',
        model,
      }),
      true,
    )
  for (const model of ['gpt-image-2', 'gpt-image-2-ext', 'gpt-image-2.5-ext'])
    assert.equal(
      showGptImageModeration({
        ...endpointForVisibility,
        engine: 'apimart-images',
        model,
      }),
      false,
    )
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'linai-moderation-test-'),
  )
  process.env.DATA_DIR = dataDir
  const imageBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  const requests: { url: string; moderation: unknown }[] = []
  let rejectModeration = false
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const isEdit = req.url === '/v1/images/edits'
      assert.ok(isEdit || req.url === '/v1/images/generations')
      const moderation = isEdit
        ? ((
            await new Request('http://localhost', {
              method: 'POST',
              headers: { 'Content-Type': String(req.headers['content-type']) },
              body,
            }).formData()
          ).get('moderation') ?? undefined)
        : JSON.parse(body.toString()).moderation
      requests.push({ url: req.url!, moderation })
      res.setHeader('Content-Type', 'application/json')
      if (rejectModeration && moderation !== undefined) {
        res.statusCode = 400
        res.end(
          JSON.stringify({
            error: { message: 'Unsupported parameter: moderation' },
          }),
        )
      } else {
        res.end(JSON.stringify({ data: [{ b64_json: imageBase64 }] }))
      }
    } catch (error) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: { message: String(error) } }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    // Import after isolation: never read the user's endpoints or write real tasks.
    const { handleImageGeneration } =
      await import('../src/server/module/gpt-image')
    const { getConfig, updateConfig } =
      await import('../src/server/common/config')
    await fs.writeFile(
      path.join(dataDir, 'images', 'input', 'reference.png'),
      Buffer.from(imageBase64, 'base64'),
    )
    const endpoint = {
      id: 'moderation-test',
      name: 'Local mock',
      apiKey: 'sk-local-test',
      baseURL: `http://127.0.0.1:${port}/v1`,
      model: 'gpt-image-2',
      editModel: 'gpt-image-2-edit',
      type: 'custom' as const,
      engine: 'openai-images' as const,
    }
    const template = {
      id: 'moderation-test',
      title: 'Moderation integration test',
      prompt: 'test',
      images: [] as string[],
      aspectRatio: '1:1',
      n: 1,
      usageType: 'image' as const,
      createdAt: Date.now(),
    }
    const modes: (GptImageModeration | undefined)[] = [
      undefined,
      'omit',
      'auto',
      'low',
    ]
    for (const mode of modes) {
      updateConfig({ endpoints: [{ ...endpoint, moderation: mode }] })
      const saved = JSON.parse(
        await fs.readFile(path.join(dataDir, 'config.json'), 'utf8'),
      )
      assert.equal(saved.endpoints[0].moderation, mode)
      for (const edit of [false, true]) {
        template.images = edit ? ['/api/static/images/input/reference.png'] : []
        const before = requests.length
        const result = await handleImageGeneration({
          ...getConfig().endpoints[0],
          template,
          writeMetadata: false,
        })
        assert.equal(result.status, 200, JSON.stringify(result.data))
        assert.equal(requests.length, before + 1)
        assert.deepEqual(requests.at(-1), {
          url: edit ? '/v1/images/edits' : '/v1/images/generations',
          moderation: mode === 'omit' ? undefined : (mode ?? 'low'),
        })
      }
    }
    // Check the actual model used for each request, including mixed endpoints.
    for (const [model, editModel, expectedGenerate, expectedEdit] of [
      ['flux-test', undefined, undefined, undefined],
      ['flux-test', 'GPT-IMAGE-EDIT', undefined, 'low'],
      ['OpenAI/GpT-image-test', 'flux-edit', 'low', undefined],
    ] as const) {
      for (const moderation of [undefined, 'auto', 'low'] as const) {
        for (const edit of [false, true]) {
          template.images = edit
            ? ['/api/static/images/input/reference.png']
            : []
          const result = await handleImageGeneration({
            ...endpoint,
            model,
            editModel,
            moderation,
            template,
            writeMetadata: false,
          })
          assert.equal(result.status, 200, JSON.stringify(result.data))
          const expected = edit ? expectedEdit : expectedGenerate
          assert.equal(
            requests.at(-1)?.moderation,
            expected ? (moderation ?? expected) : undefined,
            `${model} / ${editModel}, edit=${edit}, moderation=${moderation}`,
          )
        }
      }
    }
    // An incompatible provider must fail once, without a second billable submission.
    rejectModeration = true
    for (const edit of [false, true]) {
      template.images = edit ? ['/api/static/images/input/reference.png'] : []
      const before = requests.length
      const options = { ...endpoint, template, writeMetadata: false }
      const failed = await handleImageGeneration({
        ...options,
        moderation: 'low',
      })
      assert.equal(failed.status, 400)
      assert.match(
        'error' in failed.data ? failed.data.error : '',
        /Unsupported parameter: moderation/,
      )
      assert.equal(requests.length, before + 1, 'Must not retry automatically')
      const omitted = await handleImageGeneration({
        ...options,
        moderation: 'omit',
      })
      assert.equal(omitted.status, 200)
      assert.equal(requests.at(-1)?.moderation, undefined)
    }
    console.log(
      'GPT Image moderation passed: all modes persisted, JSON generation and multipart edits, rejection without retries, and omission for incompatible providers. Local mock only.',
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    // Only the unique directory created by this test is removed.
    await fs.rm(dataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
