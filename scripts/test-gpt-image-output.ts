import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { imageThumbnailUrl } from '../src/client/utils/imageUrls'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-image-output-'))
  process.env.DATA_DIR = root
  const pixels = Buffer.from([
    ...Array(4).fill([255, 0, 0]).flat(),
    ...Array(4).fill([0, 255, 0]).flat(),
    ...Array(4).fill([0, 0, 255]).flat(),
  ])
  const gif = await sharp(pixels, {
    raw: { width: 2, height: 6, channels: 3, pageHeight: 2 },
  })
    .gif({ loop: 0, delay: [120, 120, 120] })
    .toBuffer()
  assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 3)
  const png = await sharp(gif).png().toBuffer()
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/><script>alert(1)</script></svg>',
  )
  const requests: Record<string, unknown>[] = []
  let reject = false
  let rejectionMessage = 'GIF preview not enabled'
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const form = req.url?.endsWith('/edits')
        ? await new Request('http://localhost', {
            method: 'POST',
            headers: { 'Content-Type': String(req.headers['content-type']) },
            body,
          }).formData()
        : undefined
      const parsed = form
        ? Object.fromEntries(form.entries())
        : JSON.parse(body.toString())
      const uploadedImages = await Promise.all(
        (form?.getAll('image[]') || []).map(async (file) => {
          assert.notEqual(typeof file, 'string')
          const image = file as File
          return {
            name: image.name,
            type: image.type,
            bytes: Buffer.from(await image.arrayBuffer()),
          }
        }),
      )
      requests.push({ ...parsed, uploadedImages, url: req.url })
      res.setHeader('Content-Type', 'application/json')
      if (reject) {
        res
          .writeHead(400)
          .end(JSON.stringify({ error: { message: rejectionMessage } }))
      } else {
        const output =
          parsed.output_format === 'gif'
            ? gif
            : parsed.output_format === 'svg'
              ? svg
              : png
        res.end(
          JSON.stringify({ data: [{ b64_json: output.toString('base64') }] }),
        )
      }
    } catch (error) {
      res
        .writeHead(500)
        .end(JSON.stringify({ error: { message: String(error) } }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { updateConfig } = await import('../src/server/common/config')
    const { default: api } = await import('../src/server/api/gpt-image')
    const { default: templates } =
      await import('../src/server/api/common/template')
    const { default: images } = await import('../src/server/api/common/static')
    const { taskManager } = await import('../src/server/common/task-manager')
    const { templateManager } =
      await import('../src/server/common/template-manager')
    const endpoint = {
      id: 'output-test',
      name: 'Local output mock',
      type: 'custom' as const,
      engine: 'openai-images' as const,
      apiKey: 'sk-local-test',
      model: 'gpt-image-2.6-sunburst',
      baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    }
    updateConfig({ endpoints: [endpoint] })
    const post = (route: string, data: unknown) =>
      api.request(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    const base = {
      prompt: 'A looping animation',
      endpointId: endpoint.id,
      size: '1k',
      quality: 'medium',
    }
    const options = {
      outputFormat: 'gif',
      frameCount: 3,
      frameDurationMs: 120,
      complexity: 'low',
    }
    const generated = await post('/trial', {
      ...base,
      gptImageOptions: options,
    })
    const result = await generated.json()
    assert.equal(generated.status, 200, JSON.stringify(result))
    const request = requests.at(-1)!
    assert.equal(request.output_format, 'gif')
    assert.equal(request.frame_count, 3)
    assert.equal(request.frame_duration_ms, 120)
    assert.equal(request.complexity, 'low')
    assert.equal(request.size, 'auto')
    assert.equal(request.url, '/v1/images/generations')
    assert.equal(request.stream, undefined)
    const outputUrl: string = result.outputUrls[0]
    assert.match(outputUrl, /\.gif$/)
    const stored = await fs.readFile(
      path.join(root, 'images', 'generated', path.basename(outputUrl)),
    )
    const meta = await sharp(stored, { animated: true }).metadata()
    assert.equal(meta.pages, 3)
    assert.equal(meta.loop, 0)
    assert.deepEqual(meta.delay, [120, 120, 120])
    assert.deepEqual(
      await sharp(stored, { animated: true }).raw().toBuffer(),
      await sharp(gif, { animated: true }).raw().toBuffer(),
    )
    assert.ok(stored.includes(Buffer.from('frameDurationMs')))
    assert.deepEqual(
      (await taskManager.getTasks()).find((task) => task.id === result.taskId)
        ?.rawTemplate.gptImageOptions,
      options,
    )
    // Old clients and cached thumbnail paths must also receive the full animation.
    for (const suffix of ['', '?thumb=true', '?thumb=true&cacheVersion=old']) {
      const response = await images.request(
        outputUrl.replace('/api/static', '') + suffix,
      )
      assert.equal(response.headers.get('Content-Type'), 'image/gif')
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), stored)
    }
    for (const src of [
      outputUrl,
      `${outputUrl}?v=1#x`,
      '/api/static/images/input/A.GIF',
      'https://example.test/a.gif',
    ])
      assert.equal(imageThumbnailUrl(src, 'new-version'), src)
    assert.match(
      imageThumbnailUrl('/api/static/images/generated/a.png'),
      /thumb=true/,
    )

    const saved = await templates.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Vector icon',
        images: [],
        usageType: 'image',
        n: 1,
        gptImageOptions: {
          outputFormat: 'svg',
          complexity: 'high',
          svgModel: 'mock-svg-author',
        },
      }),
    })
    const template = (await saved.json()).data
    assert.equal(template.gptImageOptions.outputFormat, 'svg')
    const vectorResponse = await post('/generate', {
      ...base,
      templateId: template.id,
    })
    const vectorResult = await vectorResponse.json()
    assert.equal(vectorResponse.status, 200, JSON.stringify(vectorResult))
    assert.equal(requests.at(-1)?.output_format, 'svg')
    assert.deepEqual(requests.at(-1)?.svg, { model: 'mock-svg-author' })
    assert.equal(requests.at(-1)?.frame_count, undefined)
    const vector = await images.request(
      vectorResult.outputUrls[0].replace('/api/static', ''),
    )
    assert.equal(vector.headers.get('Content-Type'), 'image/svg+xml')
    assert.match(vector.headers.get('Content-Security-Policy')!, /sandbox/)
    const xml = await vector.text()
    assert.match(xml, /<rect/)
    assert.doesNotMatch(xml, /<script/)
    await templates.request(`/${template.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gptImageOptions: {} }),
    })
    assert.deepEqual(
      (await templateManager.getTemplates()).find(
        (item) => item.id === template.id,
      )?.gptImageOptions,
      {},
    )

    // Verify actual multipart files, effective edit model and new formats together.
    const secondReference = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffff00' },
    })
      .png()
      .toBuffer()
    await fs.writeFile(path.join(root, 'images', 'input', 'reference.png'), png)
    await fs.writeFile(
      path.join(root, 'images', 'input', 'second.png'),
      secondReference,
    )
    const references = [
      '/api/static/images/input/reference.png',
      '/api/static/images/input/second.png',
    ]
    for (const editModel of ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']) {
      updateConfig({
        endpoints: [{ ...endpoint, model: 'gpt-image-2', editModel }],
      })
      for (const outputFormat of ['gif', 'svg']) {
        const outputOptions =
          outputFormat === 'gif'
            ? options
            : { outputFormat, complexity: 'high', svgModel: 'mock-svg-author' }
        const response = await post('/trial', {
          ...base,
          images: references,
          gptImageOptions: outputOptions,
        })
        const edited = await response.json()
        assert.equal(response.status, 200, JSON.stringify(edited))
        const sent = requests.at(-1)!
        assert.equal(sent.url, '/v1/images/edits')
        assert.equal(sent.model, editModel)
        assert.equal(sent.output_format, outputFormat)
        assert.equal(
          sent['svg[model]'],
          outputFormat === 'svg' ? 'mock-svg-author' : undefined,
        )
        assert.equal(sent.frame_count, outputFormat === 'gif' ? '3' : undefined)
        assert.equal(
          sent.frame_duration_ms,
          outputFormat === 'gif' ? '120' : undefined,
        )
        assert.equal(sent.size, outputFormat === 'gif' ? 'auto' : '1024x1024')
        assert.equal(sent.complexity, outputFormat === 'gif' ? 'low' : 'high')
        assert.deepEqual(sent.uploadedImages, [
          { name: 'reference.png', type: 'image/png', bytes: png },
          { name: 'second.png', type: 'image/png', bytes: secondReference },
        ])
        for (const field of [
          'mask',
          'stream',
          'partial_images',
          'output_compression',
        ])
          assert.equal(sent[field], undefined)
        const task = (await taskManager.getTasks()).find(
          (item) => item.id === edited.taskId,
        )!
        assert.deepEqual(task.rawTemplate.images, references)
        assert.deepEqual(task.rawTemplate.gptImageOptions, outputOptions)
        assert.equal(task.source, editModel)
        assert.ok(edited.outputUrls[0].endsWith(`.${outputFormat}`))
        const preview = await images.request(
          edited.outputUrls[0].replace('/api/static', '') + '?thumb=true',
        )
        if (outputFormat === 'gif') {
          assert.equal(preview.headers.get('Content-Type'), 'image/gif')
          const animated = Buffer.from(await preview.arrayBuffer())
          const animation = await sharp(animated, { animated: true }).metadata()
          assert.equal(animation.pages, 3)
          assert.deepEqual(animation.delay, [120, 120, 120])
          assert.equal(animation.loop, 0)
          assert.deepEqual(
            await sharp(animated, { animated: true }).raw().toBuffer(),
            await sharp(gif, { animated: true }).raw().toBuffer(),
          )
        } else {
          await preview.arrayBuffer()
          const original = await images.request(
            edited.outputUrls[0].replace('/api/static', ''),
          )
          assert.equal(original.headers.get('Content-Type'), 'image/svg+xml')
          assert.match(await original.text(), /<rect/)
        }
      }
    }
    // Saved template generation must choose the same edit path as direct generation.
    await templates.request(`/${template.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: references,
        gptImageOptions: { outputFormat: 'svg' },
      }),
    })
    assert.equal(
      (await post('/generate', { ...base, templateId: template.id })).status,
      200,
    )
    assert.equal(requests.at(-1)?.url, '/v1/images/edits')
    assert.equal(requests.at(-1)?.output_format, 'svg')
    assert.equal(
      (
        await post('/trial', {
          ...base,
          images: references,
          gptImageOptions: { outputFormat: 'gif' },
        })
      ).status,
      200,
    )
    assert.equal(requests.at(-1)?.frame_count, '9')
    assert.equal(requests.at(-1)?.frame_duration_ms, '200')
    updateConfig({ endpoints: [endpoint] })

    const invalid = [
      { gptImageOptions: { ...options, frameCount: 17 } },
      { gptImageOptions: { ...options, frameDurationMs: 21 } },
      { gptImageOptions: { ...options, frameCount: 2.5 } },
      {
        gptImageOptions: options,
        images: Array(17).fill(references[0]),
      },
      { gptImageOptions: { outputFormat: 'svg' }, n: 2 },
      { gptImageOptions: { outputFormat: 'svg' }, images: references, n: 2 },
      { gptImageOptions: { outputFormat: 'png', frameCount: 2 } },
      { gptImageOptions: { outputFormat: 'gif', svgModel: 'mock-svg-author' } },
    ]
    const beforeInvalid = requests.length
    for (const extra of invalid)
      assert.equal((await post('/trial', { ...base, ...extra })).status, 400)
    updateConfig({ endpoints: [{ ...endpoint, editModel: 'gpt-image-2' }] })
    assert.equal(
      (
        await post('/trial', {
          ...base,
          images: references,
          gptImageOptions: options,
        })
      ).status,
      400,
    )
    for (const engine of [
      'gemini-images',
      'laozhang-images',
      'apimart-images',
    ] as const) {
      updateConfig({ endpoints: [{ ...endpoint, engine }] })
      assert.equal(
        (await post('/trial', { ...base, gptImageOptions: options })).status,
        400,
      )
    }
    updateConfig({ endpoints: [{ ...endpoint, model: 'gpt-image-2' }] })
    assert.equal(
      (await post('/trial', { ...base, gptImageOptions: options })).status,
      400,
    )
    assert.equal(
      requests.length,
      beforeInvalid,
      'Invalid combinations must never submit billable requests',
    )

    assert.equal((await post('/trial', base)).status, 200)
    for (const key of [
      'output_format',
      'frame_count',
      'frame_duration_ms',
      'complexity',
    ])
      assert.equal(
        requests.at(-1)?.[key],
        undefined,
        'Legacy requests remain unchanged',
      )
    updateConfig({ endpoints: [{ ...endpoint, model: 'gpt-image-2.6-flare' }] })
    assert.equal(
      (
        await post('/trial', {
          ...base,
          gptImageOptions: { outputFormat: 'gif' },
        })
      ).status,
      200,
    )
    assert.equal(requests.at(-1)?.frame_count, 9)
    assert.equal(requests.at(-1)?.frame_duration_ms, 200)
    await fs.writeFile(path.join(root, 'images', 'input', 'reference.png'), png)
    assert.equal(
      (
        await post('/trial', {
          ...base,
          images: ['/api/static/images/input/reference.png'],
          gptImageOptions: { outputFormat: 'png', complexity: 'medium' },
        })
      ).status,
      200,
    )
    assert.equal(requests.at(-1)?.url, '/v1/images/edits')
    assert.equal(requests.at(-1)?.complexity, 'medium')

    reject = true
    const beforeReject = requests.length
    assert.equal(
      (await post('/trial', { ...base, gptImageOptions: options })).status,
      400,
    )
    assert.equal(
      requests.length,
      beforeReject + 1,
      'No automatic retries for billable generation',
    )
    for (const outputFormat of ['gif', 'svg']) {
      rejectionMessage = `${outputFormat.toUpperCase()} preview not enabled`
      const before = requests.length
      const response = await post('/trial', {
        ...base,
        images: references,
        gptImageOptions: { outputFormat },
      })
      assert.equal(response.status, 400)
      assert.ok((await response.json()).error.includes(rejectionMessage))
      assert.equal(
        requests.length,
        before + 1,
        'No retries or format fallback on access errors',
      )
      assert.equal(requests.at(-1)?.url, '/v1/images/edits')
      assert.equal(requests.at(-1)?.output_format, outputFormat)
    }
    console.log(
      'PASS: GPT Image 2.6 JSON/multipart requests, format validation, template/task persistence, animated GIF bytes/timing/loop/pixels through preview routes, SVG/CSP, legacy compatibility and no retries. Local mock only.',
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('linai-image-output-'))
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
