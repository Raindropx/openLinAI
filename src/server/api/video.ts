import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import {
  videoEndpointSchema,
  videoModelDiscoverySchema,
  videoOptions,
} from '../../shared/video-endpoints'
import { taskManager } from '../common/task-manager'
import { videoEndpointSettings } from '../common/video-endpoint-settings'
import { discoverVideoModels } from '../module/video/configured-provider'
import { syncVideoEndpoints } from '../module/video/endpoint-registry'
import { videoManager } from '../module/video/manager'
import { videoRequestSchema } from '../module/video/providers'
import {
  openLocalVideo,
  parseVideoRange,
  videoMaxBytes,
  videoTimeoutMs,
  VideoStorageError,
  VideoTransfer,
} from '../module/video/storage'

const idSchema = z.object({ id: z.string().uuid() })
let activeCloudDownloads = 0
const inUseVideoEndpoints = async () =>
  new Set(
    (await taskManager.getTasks()).flatMap((task) =>
      task.video ? [task.video.request.provider] : [],
    ),
  )

export async function serveLocalVideo(
  id: string,
  options: { range?: string; download?: boolean; head?: boolean } = {},
) {
  const { video } = await videoManager.task(id)
  if (!video.result?.localFileId)
    return new Response('本地视频尚未取回', { status: 404 })
  let opened: Awaited<ReturnType<typeof openLocalVideo>>
  try {
    opened = await openLocalVideo(video.result.localFileId)
  } catch {
    return new Response('本地视频不可用，请刷新来源以回退云端', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const { handle, stat } = opened
  const mime = video.result.mimeType || 'video/mp4'
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${options.download ? 'attachment' : 'inline'}; filename="video-${id}.${mime === 'video/webm' ? 'webm' : 'mp4'}"`,
  }
  let range: ReturnType<typeof parseVideoRange>
  try {
    range = parseVideoRange(options.range, stat.size)
  } catch {
    await handle.close()
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        'Content-Range': `bytes */${stat.size}`,
        'Content-Length': '0',
      },
    })
  }
  headers['Content-Length'] = String(range.end - range.start + 1)
  if (range.partial)
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`
  if (options.head) await handle.close()
  return new Response(
    options.head
      ? null
      : (Readable.toWeb(
          handle.createReadStream({ start: range.start, end: range.end }),
        ) as ReadableStream<Uint8Array>),
    { status: range.partial ? 206 : 200, headers },
  )
}

export const videoApi = new Hono()
  .onError((error, c) =>
    c.json(
      {
        success: false as const,
        error:
          error instanceof VideoStorageError
            ? error.message
            : '视频操作失败，请检查任务状态、服务商与存储配置',
      },
      400,
    ),
  )
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('Origin')
      const expectedOrigin =
        process.env.VIDEO_PUBLIC_ORIGIN || new URL(c.req.url).origin
      if (
        c.req.header('Sec-Fetch-Site') === 'cross-site' ||
        (origin && origin !== expectedOrigin)
      )
        return c.json(
          { success: false as const, error: '拒绝跨站视频操作' },
          403,
        )
      if (
        !c.req
          .header('Content-Type')
          ?.toLowerCase()
          .startsWith('application/json')
      )
        return c.json(
          { success: false as const, error: '视频操作需要 JSON 请求' },
          415,
        )
    }
    await next()
  })
  .use('*', bodyLimit({ maxSize: 64 * 1024 }))
  .get('/endpoints', async (c) =>
    c.json({
      success: true as const,
      data: await videoEndpointSettings.publicSettings(),
    }),
  )
  .put('/endpoints', zValidator('json', videoEndpointSchema), async (c) => {
    try {
      const input = c.req.valid('json')
      const inUse = await inUseVideoEndpoints()
      const data = await videoEndpointSettings.save(input, inUse)
      await syncVideoEndpoints()
      return c.json({ success: true as const, data })
    } catch (error) {
      return c.json(
        { success: false as const, error: (error as Error).message },
        400,
      )
    }
  })
  .delete('/endpoints/:id', zValidator('param', idSchema), async (c) => {
    try {
      const data = await videoEndpointSettings.remove(
        c.req.valid('param').id,
        await inUseVideoEndpoints(),
      )
      await syncVideoEndpoints()
      return c.json({ success: true as const, data })
    } catch (error) {
      return c.json(
        { success: false as const, error: (error as Error).message },
        400,
      )
    }
  })
  .post(
    '/endpoints/models',
    zValidator('json', videoModelDiscoverySchema),
    async (c) => {
      try {
        const input = c.req.valid('json')
        const saved = (await videoEndpointSettings.read()).find(
          (endpoint) => endpoint.id === input.id,
        )
        const sameDestination =
          saved?.protocol === input.protocol &&
          saved?.baseURL.replace(/\/+$/, '') ===
            input.baseURL.replace(/\/+$/, '')
        const apiKey = input.apiKey || (sameDestination ? saved?.apiKey : '')
        if (!apiKey) throw new Error('读取模型前请填写 API Key')
        const data = await discoverVideoModels({
          ...input,
          name: '',
          model: '',
          enabled: false,
          mediaHosts: [],
          options: input.options || videoOptions(),
          apiKey,
        })
        return c.json({ success: true as const, data })
      } catch (error) {
        return c.json(
          { success: false as const, error: (error as Error).message },
          400,
        )
      }
    },
  )
  .get('/capabilities', async (c) => {
    await syncVideoEndpoints()
    return c.json({ success: true as const, data: videoManager.capabilities() })
  })
  .post('/', zValidator('json', videoRequestSchema), async (c) => {
    try {
      return c.json({
        success: true as const,
        data: await videoManager.create(c.req.valid('json')),
      })
    } catch {
      return c.json(
        {
          success: false as const,
          error: '视频参数不受支持、参考图无效、服务商未配置或队列已满',
        },
        400,
      )
    }
  })
  .get('/:id/sources', zValidator('param', idSchema), async (c) =>
    c.json({
      success: true as const,
      data: await videoManager.sources(c.req.valid('param').id),
    }),
  )
  .post('/:id/refresh', zValidator('param', idSchema), async (c) => {
    await videoManager.remoteResult(c.req.valid('param').id, true)
    return c.json({
      success: true as const,
      data: await videoManager.sources(c.req.valid('param').id),
    })
  })
  .post('/:id/retry', zValidator('param', idSchema), async (c) => {
    await videoManager.retryGeneration(c.req.valid('param').id)
    return c.json({ success: true as const })
  })
  .post('/:id/retrieve', zValidator('param', idSchema), async (c) => {
    await videoManager.sources(c.req.valid('param').id)
    await videoManager.queueRetrieval(c.req.valid('param').id)
    return c.json({ success: true as const })
  })
  .post('/:id/cancel-retrieval', zValidator('param', idSchema), async (c) => {
    await videoManager.cancelRetrieval(c.req.valid('param').id)
    return c.json({ success: true as const })
  })
  .post('/:id/pause-retrieval', zValidator('param', idSchema), async (c) => {
    await videoManager.pauseRetrieval(c.req.valid('param').id)
    return c.json({ success: true as const })
  })
  .post('/:id/restart-retrieval', zValidator('param', idSchema), async (c) => {
    await videoManager.restartRetrieval(c.req.valid('param').id)
    return c.json({ success: true as const })
  })
  .delete('/:id/local', zValidator('param', idSchema), async (c) => {
    await videoManager.deleteLocal(c.req.valid('param').id)
    return c.json({ success: true as const })
  })
  .get('/:id/file', zValidator('param', idSchema), (c) =>
    serveLocalVideo(c.req.valid('param').id, {
      range: c.req.header('Range'),
      head: c.req.method === 'HEAD',
    }),
  )
  .get('/:id/download', zValidator('param', idSchema), (c) =>
    serveLocalVideo(c.req.valid('param').id, {
      range: c.req.header('Range'),
      download: true,
      head: c.req.method === 'HEAD',
    }),
  )
  .get(
    '/:id/:delivery',
    zValidator(
      'param',
      idSchema.extend({
        delivery: z.enum(['cloud-download', 'cloud-preview']),
      }),
    ),
    async (c) => {
      if (activeCloudDownloads >= 2)
        return c.json(
          { success: false as const, error: '云端下载并发已满，请稍后重试' },
          429,
        )
      activeCloudDownloads++
      let released = false
      const release = () => {
        if (!released) {
          released = true
          activeCloudDownloads--
        }
      }
      try {
        const id = c.req.valid('param').id
        const controller = new AbortController()
        const signal = AbortSignal.any([
          controller.signal,
          c.req.raw.signal,
          AbortSignal.timeout(videoTimeoutMs()),
        ])
        const remote = await videoManager.openCloud(id, signal)
        const total =
          remote.headers['content-length'] === undefined
            ? undefined
            : Number(remote.headers['content-length'])
        if (
          total !== undefined &&
          (!Number.isSafeInteger(total) ||
            total <= 0 ||
            total > videoMaxBytes())
        ) {
          remote.destroy()
          throw new Error('视频大小超出限制')
        }
        const mime = remote.headers['content-type']!.split(';')[0]
        const headers: Record<string, string> = {
          'Content-Type': mime,
          'Content-Disposition': `${c.req.valid('param').delivery === 'cloud-preview' ? 'inline' : 'attachment'}; filename="video-${id}.${mime === 'video/webm' ? 'webm' : 'mp4'}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Accept-Ranges': 'none',
        }
        if (total !== undefined) headers['Content-Length'] = String(total)
        if (c.req.method === 'HEAD') {
          remote.destroy()
          release()
          return new Response(null, { headers })
        }
        const transfer = new VideoTransfer({ total })
        transfer.once('close', release)
        transfer.on('close', () => controller.abort())
        void pipeline(remote, transfer, { signal }).catch(() =>
          transfer.destroy(),
        )
        return new Response(
          Readable.toWeb(transfer) as ReadableStream<Uint8Array>,
          { headers },
        )
      } catch (error) {
        release()
        throw error
      }
    },
  )

export default videoApi
