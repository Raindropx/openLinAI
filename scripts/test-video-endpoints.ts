import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { VideoRequest } from '../src/shared/video'
import {
  VIDEO_ENDPOINT_PRESETS,
  VIDEO_MODEL_CATALOG,
  videoEndpointSchema,
  videoModelDiscoverySchema,
  videoOptions,
} from '../src/shared/video-endpoints'
import {
  videoModelOptions,
  videoModelsFromCatalog,
} from '../src/shared/video-model-options'

async function main() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'linai-video-endpoints-'),
  )
  process.env.DATA_DIR = root
  try {
    const { VideoEndpointSettings } =
      await import('../src/server/common/video-endpoint-settings')
    const {
      ConfiguredVideoProvider,
      buildVideoBody,
      normalizeVideoStatus,
      readVideoInputImage,
      discoverVideoModels,
    } = await import('../src/server/module/video/configured-provider')
    const { videoApi } = await import('../src/server/api/video')
    const { videoEndpointSettings } =
      await import('../src/server/common/video-endpoint-settings')
    const { syncVideoEndpoints } =
      await import('../src/server/module/video/endpoint-registry')
    const { videoManager } = await import('../src/server/module/video/manager')
    const store = new VideoEndpointSettings(path.join(root, 'settings'))
    const make = (
      protocol:
        | 'xai'
        | 'openrouter'
        | 'ark'
        | 'venice'
        | 'civitai'
        | 'gemini'
        | 'openlux-minimax' = 'xai',
      model = 'grok-imagine-video',
    ) => ({
      id: randomUUID(),
      name: 'Test video',
      enabled: true,
      protocol,
      baseURL: 'https://api.example.com/v1',
      model,
      options: videoOptions(),
      mediaHosts: ['media.example.com'],
      apiKey: 'test-key-not-real',
    })
    for (const preset of [...VIDEO_ENDPOINT_PRESETS, ...VIDEO_MODEL_CATALOG])
      assert.ok(
        videoEndpointSchema.safeParse({ ...preset, id: randomUUID() }).success,
        preset.id,
      )
    assert.equal(
      new Set(VIDEO_ENDPOINT_PRESETS.map((p) => p.id)).size,
      VIDEO_ENDPOINT_PRESETS.length,
    )
    assert.equal(VIDEO_ENDPOINT_PRESETS.length, 14)
    assert.equal(
      new Set(VIDEO_ENDPOINT_PRESETS.map((p) => `${p.protocol}|${p.baseURL}`))
        .size,
      VIDEO_ENDPOINT_PRESETS.length,
    )
    for (const protocol of ['spicy', 'openrouter', 'venice', 'xai', 'civitai'])
      assert.equal(
        VIDEO_ENDPOINT_PRESETS.filter((p) => p.protocol === protocol).length,
        1,
      )
    const connection = {
      id: randomUUID(),
      protocol: 'xai',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'fake',
    }
    assert.ok(videoModelDiscoverySchema.safeParse(connection).success)
    const catalog = {
      data: [
        { id: 'gpt-text', architecture: { output_modalities: ['text'] } },
        { id: 'grok-imagine-image', modality: 'image' },
        { id: 'MiniMax-H3' },
        { id: 'doubao-seedance-2-0' },
        { id: 'wan3.0-video' },
        { id: 'custom-output', architecture: { output_modalities: ['video'] } },
        { id: 'retired-video', enabled: false },
        { id: 'offline-video', model_spec: { offline: true } },
        { id: 'wan3.0-video' },
      ],
    }
    assert.deepEqual(
      videoModelsFromCatalog('openai-video', catalog).map((model) => model.id),
      ['MiniMax-H3', 'doubao-seedance-2-0', 'wan3.0-video', 'custom-output'],
    )
    const paths: string[] = []
    const discovered = await discoverVideoModels(
      { ...make(), protocol: 'openrouter' },
      async (_endpoint, route) => {
        paths.push(route)
        return {
          data: [
            {
              id: 'new-video-model',
              supported_durations: [4, 8],
              supported_resolutions: ['1080p'],
            },
          ],
        }
      },
    )
    assert.deepEqual(paths, ['/videos/models'])
    assert.equal(discovered[0].id, 'new-video-model')
    assert.deepEqual(discovered[0].options?.durations, [4, 8])
    assert.deepEqual(discovered[0].options?.resolutions, ['1080p'])
    assert.equal(
      VIDEO_ENDPOINT_PRESETS.find((p) => p.id === 'leaderai-custom')?.enabled,
      false,
    )
    assert.equal(
      VIDEO_ENDPOINT_PRESETS.find((p) => p.id === 'fasth3-custom')?.enabled,
      false,
    )
    const endpoint = make()
    await store.save(endpoint)
    assert.equal(
      JSON.stringify(await store.publicSettings()).includes(endpoint.apiKey),
      false,
    )
    assert.equal((await store.publicSettings())[0].apiKeyConfigured, true)
    await store.save({ ...endpoint, apiKey: '', name: 'Renamed' })
    assert.equal((await store.read())[0].apiKey, endpoint.apiKey)
    await assert.rejects(
      store.save({
        ...endpoint,
        baseURL: 'https://different.example.com/v1',
        apiKey: '',
      }),
      /重新填写/,
    )
    await assert.rejects(
      store.save({ ...endpoint, model: 'other' }, new Set([endpoint.id])),
      /关联视频任务/,
    )
    await assert.rejects(
      store.remove(endpoint.id, new Set([endpoint.id])),
      /关联视频任务/,
    )
    await store.save(
      { ...endpoint, enabled: false, apiKey: '' },
      new Set([endpoint.id]),
    )
    assert.equal((await store.read())[0].enabled, false)
    await store.remove(endpoint.id)
    assert.equal((await store.read()).length, 0)
    assert.equal(
      videoEndpointSchema.safeParse({
        ...endpoint,
        baseURL: 'https://api.example.com/v1?key=private',
      }).success,
      false,
    )
    assert.equal(
      videoEndpointSchema.safeParse({
        ...endpoint,
        mediaHosts: ['*.example.com'],
      }).success,
      false,
    )
    await assert.rejects(
      readVideoInputImage('/api/static/images/input/../secret'),
      /本地输入图/,
    )
    const input: VideoRequest = {
      provider: endpoint.id,
      model: endpoint.model,
      prompt: 'A cloud over the mountain',
      generationType: 'image_to_video',
      frameMode: 'first_last_frame',
      inputImages: ['/first.png', '/last.png'],
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
    }
    const first = 'data:image/png;base64,first'
    const last = 'data:image/png;base64,last'
    const openrouter = buildVideoBody(
      make('openrouter'),
      input,
      [first, last],
      'local',
    )
    assert.equal(openrouter.frame_images[1].frame_type, 'last_frame')
    assert.equal(openrouter.frame_images[0].image_url.url, first)
    const ark = buildVideoBody(make('ark'), input, [first, last], 'local')
    assert.equal(ark.content[1].role, 'first_frame')
    assert.equal(ark.content[2].role, 'last_frame')
    const xai = buildVideoBody(endpoint, input, [first, last], 'local')
    assert.deepEqual(xai.last_frame, { url: last })
    const lux = buildVideoBody(
      make('openlux-minimax', 'MiniMax-H3'),
      input,
      [first, last],
      'local',
    )
    assert.equal(lux.prompt, undefined)
    assert.equal(lux.content[0].type, 'text')
    assert.equal(lux.content[2].role, 'last_frame')
    const reference = {
      ...input,
      generationType: 'reference_to_video' as const,
      frameMode: undefined,
      references: [{ type: 'image' as const, imageUrl: '/ref.png' }],
    }
    const civitai = buildVideoBody(
      make('civitai', 'minimax-h3:standard'),
      { ...reference, model: 'minimax-h3:standard' },
      [first],
      'local-id',
    )
    assert.equal(civitai.externalId, 'openlinai-local-id')
    assert.equal(civitai.steps[0].$type, 'videoGen')
    assert.equal(civitai.steps[0].retries, 0)
    assert.equal(civitai.steps[0].input.firstFrameImage, undefined)
    assert.deepEqual(civitai.steps[0].input.referenceImages, [first])
    assert.throws(
      () =>
        buildVideoBody(
          make('civitai', 'seedance:v2'),
          { ...input, model: 'seedance:v2' },
          [first, last],
          'local',
        ),
      /不能作为固定首尾帧/,
    )
    const gemini = buildVideoBody(make('gemini'), reference, [first], 'local')
    assert.equal(gemini.response_format.delivery, 'uri')
    assert.equal(gemini.response_format.type, 'video')
    assert.equal(normalizeVideoStatus('done'), 'succeeded')
    assert.equal(normalizeVideoStatus('ACTIVE'), 'succeeded')
    assert.throws(() => normalizeVideoStatus('something-new'), /未知/)
    const options = videoModelOptions('spicy', {
      tasks: ['image-to-video'],
      inputSchema: {
        properties: {
          image_url: {},
          last_image_url: {},
          resolution: { enum: ['768p'] },
          duration_seconds: { minimum: 4, maximum: 15 },
          prompt: { maxLength: 7000 },
        },
      },
    })
    assert.deepEqual(options.resolutions, ['768p'])
    assert.equal(options.durations[0], 4)
    assert.equal(options.durations.at(-1), 15)
    assert.deepEqual(options.frameModes, ['first_frame', 'first_last_frame'])
    const automatic = videoModelOptions('spicy', {
      tasks: ['text-to-video'],
      inputSchema: {
        properties: {
          duration_seconds: {
            oneOf: [{ const: -1 }, { minimum: 4, maximum: 15 }],
          },
        },
      },
    })
    assert.equal(automatic.durations.includes(-1), false)
    assert.equal(automatic.durations.includes(0), false)
    assert.equal(automatic.durations[0], 4)
    const veniceOptions = videoModelOptions('venice', {
      id: 'minimax-h3-reference-to-video',
      model_spec: {
        constraints: {
          model_type: 'image-to-video',
          durations: ['5s', '8s'],
          resolutions: ['768P'],
          aspect_ratios: ['16:9'],
          prompt_character_limit: 3000,
          video_input: false,
        },
      },
    })
    assert.deepEqual(veniceOptions.generationTypes, ['reference_to_video'])
    assert.deepEqual(veniceOptions.durations, [5, 8])
    assert.equal(veniceOptions.references?.maxVideos, 0)
    const calls: Array<{ route: string; body?: unknown }> = []
    const provider = new ConfiguredVideoProvider(
      make('openrouter'),
      async (_endpoint, route, _signal, body) => {
        calls.push({ route, body })
        return body
          ? { id: 'job-1' }
          : {
              status: 'completed',
              unsigned_urls: [
                'https://api.example.com/v1/videos/job-1/content',
              ],
            }
      },
    )
    await provider.submitGeneration(
      {
        ...input,
        generationType: 'text_to_video',
        inputImages: [],
        frameMode: undefined,
      },
      'local',
      new AbortController().signal,
    )
    assert.equal(
      calls.filter((call) => call.body).length,
      1,
      'Never automatically resubmit a billable task',
    )
    assert.equal(
      (
        await provider.getGenerationStatus(
          'job-1',
          new AbortController().signal,
        )
      ).status,
      'succeeded',
    )
    const result = await provider.getResult(
      'job-1',
      new AbortController().signal,
    )
    assert.equal(result.providerMedia, true)
    assert.equal(
      result.remoteUrl,
      'https://api.example.com/v1/videos/job-1/content',
    )
    assert.equal(JSON.stringify(result).includes('test-key'), false)
    const fixtures = [
      {
        protocol: 'ark',
        model: 'seedance',
        create: { id: 'ark-id' },
        poll: {
          status: 'succeeded',
          content: { video_url: 'https://media.example.com/ark.mp4' },
        },
        path: '/contents/generations/tasks',
      },
      {
        protocol: 'laozhang-wan',
        model: 'wan2.7-t2v',
        create: { output: { task_id: 'wan-id' } },
        poll: {
          status: 'completed',
          result_url: 'https://media.example.com/wan.mp4',
        },
        path: '/wan/api/v1/services/aigc/video-generation/video-synthesis',
      },
      {
        protocol: 'openlux-minimax',
        model: 'MiniMax-H3',
        create: { task_id: 'h3-id' },
        poll: {
          task: {
            status: 'succeeded',
            content: { video_url: 'https://media.example.com/h3.mp4' },
          },
        },
        path: '/minimax/v2/video_generation',
      },
      {
        protocol: 'openlux-omni',
        model: 'omni-flash',
        create: { id: 'omni-id' },
        poll: {
          status: 'completed',
          video_url: 'https://media.example.com/omni.mp4',
        },
        path: '/v1/video/create',
      },
      {
        protocol: 'xai',
        model: 'grok-imagine-video',
        create: { request_id: 'xai-id' },
        poll: {
          status: 'done',
          video: { url: 'https://media.example.com/grok.mp4' },
        },
        path: '/videos/generations',
      },
      {
        protocol: 'civitai',
        model: 'minimax-h3:standard',
        create: { id: 'workflow-id' },
        poll: {
          status: 'succeeded',
          steps: [
            {
              output: {
                video: {
                  available: true,
                  url: 'https://media.example.com/civitai.mp4',
                },
              },
            },
          ],
        },
        path: '/workflows?wait=0',
      },
      {
        protocol: 'fastvideo',
        model: 'fasth3',
        create: { id: 'fast-id' },
        poll: { status: 'completed' },
        path: '/videos',
      },
    ] as const
    for (const fixture of fixtures) {
      const requests: Array<{ route: string; body?: Record<string, any> }> = []
      const ep = { ...make(), protocol: fixture.protocol, model: fixture.model }
      const adapter = new ConfiguredVideoProvider(
        ep,
        async (_endpoint, route, _signal, body) => {
          requests.push({ route, body: body as Record<string, any> })
          return body
            ? structuredClone(fixture.create)
            : structuredClone(fixture.poll)
        },
      )
      const request = {
        ...input,
        model: ep.model,
        generationType: 'text_to_video' as const,
        inputImages: [],
        frameMode: undefined,
      }
      const id = await adapter.submitGeneration(
        request,
        'test-local',
        new AbortController().signal,
      )
      assert.equal(requests[0].route, fixture.path)
      if (fixture.protocol === 'fastvideo')
        assert.deepEqual(requests[0].body, {
          model: 'fasth3',
          prompt: input.prompt,
        })
      assert.equal(
        (await adapter.getGenerationStatus(id, new AbortController().signal))
          .status,
        'succeeded',
        fixture.protocol,
      )
      const output = await adapter.getResult(id, new AbortController().signal)
      assert.ok(output.remoteUrl, fixture.protocol)
      assert.equal(requests.filter((item) => item.body).length, 1)
    }
    const g = new ConfiguredVideoProvider(make('gemini'), async () => ({
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'video',
              uri: 'https://api.example.com/v1/files/google123:download?alt=media',
            },
          ],
        },
      ],
    }))
    const gid = await g.submitGeneration(
      { ...input, inputImages: [] },
      'local',
      new AbortController().signal,
    )
    assert.equal(gid, 'file:google123')
    const failing = new ConfiguredVideoProvider(endpoint, async () => {
      throw new Error('lost response')
    })
    await assert.rejects(
      failing.submitGeneration(
        { ...input, inputImages: [] },
        'local',
        new AbortController().signal,
      ),
      /lost response/,
    )
    // Actual Hono routes, isolated data directory; no external provider calls.
    const headers = { 'Content-Type': 'application/json' }
    let probe = await videoApi.request('/endpoints/models', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...connection, apiKey: '' }),
    })
    assert.equal(probe.status, 400)
    assert.equal((await probe.json()).error, '读取模型前请填写 API Key')
    // Civitai has no discovery route; no external call is made and manual input remains available.
    probe = await videoApi.request('/endpoints/models', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...connection, protocol: 'civitai' }),
    })
    assert.match((await probe.json()).error, /内置候选或手动填写/)
    // Saving a manually entered ID does not require a working model directory or network access.
    const manual = {
      ...make(),
      protocol: 'spicy',
      model: 'custom-video-not-in-catalog',
    }
    const manualResponse = await videoApi.request('/endpoints', {
      method: 'PUT',
      headers,
      body: JSON.stringify(manual),
    })
    assert.equal(manualResponse.status, 200)
    await videoEndpointSettings.remove(manual.id)
    let response = await videoApi.request('/endpoints', {
      method: 'PUT',
      headers,
      body: JSON.stringify(endpoint),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.text()).includes(endpoint.apiKey), false)
    response = await videoApi.request('/capabilities')
    assert.equal(
      (await response.json()).data.some(
        (item: { provider: string }) => item.provider === endpoint.id,
      ),
      true,
    )
    await videoEndpointSettings.save({ ...endpoint, enabled: false })
    await syncVideoEndpoints()
    assert.equal(
      videoManager.capabilities().some((item) => item.provider === endpoint.id),
      false,
    )
    response = await videoApi.request('/endpoints', {
      method: 'PUT',
      headers: { ...headers, Origin: 'https://other.example.com' },
      body: JSON.stringify(endpoint),
    })
    assert.equal(response.status, 403)
    response = await videoApi.request(`/endpoints/${endpoint.id}`, {
      method: 'DELETE',
      headers,
      body: '{}',
    })
    assert.equal(response.status, 200)
    console.log(
      `Video endpoint checks passed (${VIDEO_ENDPOINT_PRESETS.length} presets; settings, credential retention, task bindings, protocol bodies, polling, protected playback, Gemini URI, Hono routes)`,
    )
  } finally {
    assert.ok(
      path
        .resolve(root)
        .startsWith(
          path.join(path.resolve(os.tmpdir()), 'linai-video-endpoints-'),
        ),
    )
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
