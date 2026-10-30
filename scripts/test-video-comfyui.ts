import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { comfyVideoSchema } from '../src/shared/comfyui-video'
import type { VideoRequest } from '../src/shared/video'
import {
  videoEndpointSchema,
  videoModelDiscoverySchema,
  videoOptions,
} from '../src/shared/video-endpoints'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-comfy-video-'))
  process.env.DATA_DIR = root
  process.env.VIDEO_STORAGE_DIR = root
  process.env.VIDEO_MIN_FREE_BYTES = '1'
  let state = 'queued',
    uploads = 0,
    prompts = 0
  let submitted: any
  let redirect = false,
    receivedRange = ''
  let outputList = 'videos'
  const media = Buffer.concat([
    Buffer.from([
      0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
    ]),
    Buffer.alloc(4096),
  ])
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      assert.equal(
        req.headers.authorization,
        undefined,
        'No empty bearer header',
      )
      res.setHeader('Content-Type', 'application/json')
      const url = new URL(req.url!, 'http://localhost')
      if (url.pathname === '/upload/image') {
        uploads++
        assert.match(
          req.headers['content-type']!,
          /^multipart\/form-data; boundary=/,
        )
        assert.ok(body.includes('name="image"'))
        res.end(
          JSON.stringify({
            name: `image-${uploads}.png`,
            subfolder: 'uploads',
            type: 'input',
          }),
        )
      } else if (url.pathname === '/prompt') {
        prompts++
        submitted = JSON.parse(body.toString())
        res.end(JSON.stringify({ prompt_id: 'prompt-1', node_errors: {} }))
      } else if (url.pathname === '/history/prompt-1') {
        res.end(
          JSON.stringify(
            ['done', 'error', 'missing-output'].includes(state)
              ? {
                  'prompt-1': {
                    status: {
                      completed: state !== 'error',
                      status_str: state === 'error' ? 'error' : 'success',
                    },
                    outputs:
                      state === 'missing-output'
                        ? {}
                        : {
                            '9': {
                              images: [
                                { filename: 'preview.png', type: 'output' },
                              ],
                              [outputList]: [
                                {
                                  filename: 'movie.mp4',
                                  subfolder: 'video',
                                  type: 'output',
                                },
                              ],
                            },
                          },
                  },
                }
              : {},
          ),
        )
      } else if (url.pathname === '/queue') {
        res.end(
          JSON.stringify({
            queue_running: state === 'running' ? [[0, 'prompt-1']] : [],
            queue_pending: state === 'queued' ? [[0, 'prompt-1']] : [],
          }),
        )
      } else if (url.pathname === '/system_stats') {
        res.end(
          JSON.stringify({ system: { comfyui_version: 'test' }, devices: [] }),
        )
      } else if (url.pathname === '/view') {
        if (redirect) {
          res.writeHead(302, { Location: 'http://127.0.0.1:1/secret' })
          res.end()
          return
        }
        assert.equal(url.searchParams.get('filename'), 'movie.mp4')
        assert.equal(url.searchParams.get('subfolder'), 'video')
        receivedRange = req.headers.range || ''
        const offset = receivedRange
          ? Number(receivedRange.match(/bytes=(\d+)-/)![1])
          : 0
        res.writeHead(offset ? 206 : 200, {
          'Content-Type': 'video/mp4',
          'Content-Length': media.length - offset,
          ETag: '"movie-1"',
          ...(offset
            ? {
                'Content-Range': `bytes ${offset}-${media.length - 1}/${media.length}`,
              }
            : {}),
        })
        res.end(media.subarray(offset))
      } else {
        res.statusCode = 404
        res.end('{}')
      }
    } catch (error) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(error) }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const { ComfyVideoProvider } =
    await import('../src/server/module/video/comfyui-provider')
  const { validateVideoApiTarget, isLocalVideoAddress } =
    await import('../src/server/module/video/endpoint-network')
  const { videoEndpointSettings } =
    await import('../src/server/common/video-endpoint-settings')
  const { VideoManager, videoManager } =
    await import('../src/server/module/video/manager')
  const { taskManager } = await import('../src/server/common/task-manager')
  const { videoApi } = await import('../src/server/api/video')
  const { ConfiguredVideoProvider } =
    await import('../src/server/module/video/configured-provider')
  const config = comfyVideoSchema.parse({
    workflow: {
      '1': { class_type: 'Text', inputs: { text: 'original' } },
      '2': { class_type: 'LoadImage', inputs: { image: 'original.png' } },
      '3': {
        class_type: 'Video',
        inputs: { width: 1, height: 1, length: 1, seed: 1, clip: ['1', 0] },
      },
      '9': { class_type: 'SaveVideo', inputs: { video: ['3', 0] } },
    },
    bindings: [
      { nodeId: '1', input: 'text', source: 'prompt' },
      { nodeId: '2', input: 'image', source: 'image', imageIndex: 0 },
      { nodeId: '3', input: 'width', source: 'width' },
      { nodeId: '3', input: 'height', source: 'height' },
      { nodeId: '3', input: 'length', source: 'frameCount' },
      { nodeId: '3', input: 'seed', source: 'seed' },
    ],
    outputNodeId: '9',
    fps: 24,
    frameCountOffset: 1,
  })
  const endpoint = {
    id: randomUUID(),
    name: 'Generic workflow',
    enabled: true,
    baseURL: `http://127.0.0.1:${port}`,
    protocol: 'comfyui' as const,
    network: 'local' as const,
    model: 'my-workflow',
    options: videoOptions({
      generationTypes: ['image_to_video'],
      frameModes: ['first_frame'],
    }),
    apiKey: '',
    mediaHosts: [],
    comfyUI: config,
  }
  const signal = AbortSignal.timeout(30000)
  const provider = new ComfyVideoProvider(endpoint, undefined, async () => ({
    mime: 'image/png',
    bytes: Buffer.from('PNG'),
    dataURL: 'data:image/png;base64,UE5H',
  }))
  const input: VideoRequest = {
    provider: endpoint.id,
    model: endpoint.model,
    prompt: 'a "cloud"\n雪',
    generationType: 'image_to_video',
    inputImages: ['/image.png'],
    durationSeconds: 5,
    resolution: '720p',
    aspectRatio: '16:9',
  }
  const manager = new VideoManager()
  try {
    assert.ok(videoEndpointSchema.safeParse(endpoint).success)
    assert.equal(
      videoEndpointSchema.safeParse({ ...endpoint, network: 'public' }).success,
      false,
    )
    assert.ok(videoModelDiscoverySchema.safeParse(endpoint).success)
    assert.equal(
      comfyVideoSchema.safeParse({ ...config, workflow: { nodes: [] } })
        .success,
      false,
    )
    assert.equal(
      comfyVideoSchema.safeParse({
        ...config,
        bindings: [
          ...config.bindings,
          { nodeId: '3', input: 'clip', source: 'prompt' },
        ],
      }).success,
      false,
    )
    assert.equal(
      comfyVideoSchema.safeParse({
        ...config,
        bindings: [...config.bindings, config.bindings[0]],
      }).success,
      false,
    )
    for (const address of [
      '127.0.0.1',
      '192.168.8.127',
      '10.0.0.1',
      '100.64.0.1',
      '::1',
      'fd00::1',
    ])
      assert.ok(isLocalVideoAddress(address), address)
    for (const address of [
      '169.254.169.254',
      '0.0.0.0',
      '198.18.1.1',
      '93.184.216.34',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      assert.equal(isLocalVideoAddress(address), false, address)
    await assert.rejects(
      validateVideoApiTarget(
        { ...endpoint, baseURL: 'http://169.254.169.254' },
        '/x',
      ),
      /只允许/,
    )
    await assert.rejects(
      validateVideoApiTarget(
        { ...endpoint, baseURL: 'http://comfy.lan' },
        '/x',
        async () => [
          { address: '192.168.1.2', family: 4 },
          { address: '8.8.8.8', family: 4 },
        ],
      ),
      /只允许/,
    )
    for (const route of ['/../secret', '/%2e%2e/secret', '//elsewhere/x'])
      await assert.rejects(
        validateVideoApiTarget(
          { ...endpoint, baseURL: endpoint.baseURL + '/api' },
          route,
        ),
        /范围/,
      )
    await videoEndpointSettings.save(endpoint)
    assert.equal((await videoEndpointSettings.read())[0].apiKey, '')
    await assert.rejects(
      videoEndpointSettings.save(
        { ...endpoint, comfyUI: { ...config, fps: 30 } },
        new Set([endpoint.id]),
      ),
      /关联视频任务/,
    )
    // A local address change must clear an old saved credential instead of forwarding it.
    const credentialEndpoint = {
      ...endpoint,
      id: randomUUID(),
      apiKey: 'secret',
    }
    await videoEndpointSettings.save(credentialEndpoint)
    await videoEndpointSettings.save({
      ...credentialEndpoint,
      baseURL: endpoint.baseURL + '/other',
      apiKey: '',
    })
    assert.equal(
      (await videoEndpointSettings.read()).find(
        (item) => item.id === credentialEndpoint.id,
      )!.apiKey,
      '',
    )
    await videoEndpointSettings.remove(credentialEndpoint.id)
    const check = await videoApi.request('/endpoints/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpoint),
    })
    assert.equal(check.status, 200)
    assert.equal((await check.json()).data.version, 'test')
    const largeEndpoint = {
      ...endpoint,
      id: randomUUID(),
      enabled: false,
      comfyUI: {
        ...config,
        workflow: {
          ...config.workflow,
          '1': { ...config.workflow['1'], inputs: { text: 'x'.repeat(80000) } },
        },
      },
    }
    const savedLarge = await videoApi.request('/endpoints', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(largeEndpoint),
    })
    assert.equal(
      savedLarge.status,
      200,
      'API workflow imports must exceed the usual 64 KiB metadata limit',
    )
    await videoEndpointSettings.remove(largeEndpoint.id)
    await provider.submitGeneration(input, randomUUID(), signal)
    assert.equal(prompts, 1)
    assert.equal(uploads, 1)
    assert.equal(submitted.prompt['1'].inputs.text, input.prompt)
    assert.equal(submitted.prompt['2'].inputs.image, 'uploads/image-1.png')
    assert.equal(submitted.prompt['3'].inputs.width, 1280)
    assert.equal(submitted.prompt['3'].inputs.height, 736)
    assert.equal(submitted.prompt['3'].inputs.length, 121)
    assert.deepEqual(submitted.prompt['3'].inputs.clip, ['1', 0])
    assert.equal(config.workflow['1'].inputs.text, 'original')
    await assert.rejects(
      provider.submitGeneration(
        { ...input, inputImages: [] },
        randomUUID(),
        signal,
      ),
      /图片尚未提供/,
    )
    assert.equal(prompts, 1)
    assert.equal(
      (await provider.getGenerationStatus('prompt-1', signal)).status,
      'queued',
    )
    state = 'running'
    assert.equal(
      (await provider.getGenerationStatus('prompt-1', signal)).status,
      'processing',
    )
    state = 'error'
    assert.equal(
      (await provider.getGenerationStatus('prompt-1', signal)).status,
      'failed',
    )
    state = 'gone'
    await assert.rejects(
      provider.getGenerationStatus('prompt-1', signal),
      /不在队列/,
    )
    state = 'missing-output'
    await assert.rejects(provider.getResult('prompt-1', signal), /MP4\/WebM/)
    state = 'done'
    const restored = new ComfyVideoProvider(endpoint)
    const result = await restored.getResult('prompt-1', signal)
    assert.equal(result.providerMedia, true)
    for (const key of ['images', 'gifs']) {
      outputList = key
      assert.ok(
        (await restored.getResult('prompt-1', signal)).remoteUrl?.includes(
          'movie.mp4',
        ),
      )
    }
    outputList = 'videos'
    const ranged = await restored.openResult('prompt-1', signal, {
      offset: 100,
      etag: '"movie-1"',
    })
    assert.equal(ranged.statusCode, 206)
    const rangeChunks: Buffer[] = []
    for await (const chunk of ranged) rangeChunks.push(chunk)
    assert.deepEqual(Buffer.concat(rangeChunks), media.subarray(100))
    assert.equal(receivedRange, 'bytes=100-')
    redirect = true
    await assert.rejects(
      restored.openResult('prompt-1', signal),
      /不接受重定向/,
    )
    redirect = false
    // Generic compatible local APIs also keep media behind the saved origin.
    const generic = new ConfiguredVideoProvider(
      { ...endpoint, protocol: 'openai-video' },
      async () => ({
        status: 'completed',
        video_url:
          endpoint.baseURL + '/view?filename=movie.mp4&subfolder=video',
      }),
    )
    assert.equal(
      (await generic.getResult('prompt-1', signal)).providerMedia,
      true,
    )
    const escaped = new ConfiguredVideoProvider(
      { ...endpoint, protocol: 'openai-video' },
      async () => ({
        status: 'completed',
        video_url: 'http://127.0.0.1:1/secret',
      }),
    )
    await assert.rejects(escaped.getResult('prompt-1', signal))
    // Exercise production manager validation, refresh, proxy playback and retrieval.
    const textEndpoint = {
      ...endpoint,
      id: randomUUID(),
      options: videoOptions({
        generationTypes: ['text_to_video'],
        maxImages: 0,
      }),
      comfyUI: {
        ...config,
        bindings: config.bindings.filter(
          (binding) => binding.source !== 'image',
        ),
      },
    }
    await videoEndpointSettings.save(textEndpoint)
    const task = await manager.create({
      ...input,
      provider: textEndpoint.id,
      generationType: 'text_to_video',
      inputImages: [],
    })
    await taskManager.mutateVideoTask(task.id, (video) => {
      video.remoteTaskId = 'prompt-1'
      video.generationStatus = 'processing'
    })
    async function waitFor(check: () => Promise<boolean>) {
      const until = Date.now() + 8000
      while (Date.now() < until) {
        if (await check()) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('Timed out waiting for ComfyUI manager state')
    }
    await manager.tick()
    await waitFor(
      async () =>
        (await manager.task(task.id)).video.generationStatus === 'succeeded',
    )
    assert.equal(
      (await manager.sources(task.id)).playbackUrl,
      `/api/studio/videos/${task.id}/cloud-preview`,
    )
    assert.ok((await manager.remoteResult(task.id, true)).providerMedia)
    const stream = await manager.openCloud(task.id, signal)
    for await (const _chunk of stream) {
      /* consume proxy */
    }
    await manager.queueRetrieval(task.id)
    await manager.tick()
    await waitFor(
      async () =>
        (await manager.task(task.id)).video.retrievalStatus === 'retrieved',
    )
    assert.equal((await manager.sources(task.id)).source, 'local')
    assert.equal(
      prompts,
      1,
      'Read-only checks and restored tasks must never submit another job',
    )
    console.log(
      'ComfyUI video passed: generic mappings, multipart, queue/history, recovery, media/range, local network boundaries, credential isolation, settings/API, manager playback and retrieval.',
    )
  } finally {
    await manager.stop()
    await videoManager.stop()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
