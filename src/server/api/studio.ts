import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { STUDIO_MAX_FILE_BYTES } from '../../shared/studio'
import { studioManager, studioMimeType } from '../common/studio-manager'

const idSchema = z.object({ id: z.string().uuid() })
const studioApi = new Hono()
  .onError((error, c) =>
    c.json(
      { success: false as const, error: error.message || '工作室操作失败' },
      400,
    ),
  )
  .get('/items', async (c) =>
    c.json({ success: true as const, data: await studioManager.list() }),
  )
  .post(
    '/from-task',
    zValidator(
      'json',
      z.object({
        taskId: z.string().uuid(),
        imageIndex: z.number().int().min(0).max(1000),
      }),
    ),
    async (c) => {
      const { taskId, imageIndex } = c.req.valid('json')
      return c.json({
        success: true as const,
        data: await studioManager.fromTask(taskId, imageIndex),
      })
    },
  )
  .post(
    '/items',
    bodyLimit({
      maxSize: STUDIO_MAX_FILE_BYTES + 16384,
      onError: (c) =>
        c.json({ success: false as const, error: '文件不能超过 64 MiB' }, 413),
    }),
    async (c) => {
      const form = await c.req.formData()
      const file = form.get('file')
      const documentId = form.get('documentId')
      if (!file || typeof file === 'string') throw new Error('请选择文件')
      if (
        documentId !== null &&
        (typeof documentId !== 'string' ||
          !z.string().uuid().safeParse(documentId).success)
      )
        throw new Error('无效的文档编号')
      const item = await studioManager.upload(
        Buffer.from(await file.arrayBuffer()),
        file.name,
        documentId || undefined,
      )
      return c.json({ success: true as const, data: item })
    },
  )
  .post(
    '/documents',
    zValidator(
      'json',
      z.object({
        itemId: z.string().uuid().optional(),
        external: z.boolean().optional(),
      }),
    ),
    async (c) =>
      c.json({
        success: true as const,
        data: await studioManager.document(
          c.req.valid('json').itemId,
          c.req.valid('json').external,
        ),
      }),
  )
  .post(
    '/empty',
    zValidator(
      'json',
      z.object({ ids: z.array(z.string().uuid()).max(10000) }),
    ),
    async (c) =>
      c.json({
        success: true as const,
        data: await studioManager.remove(c.req.valid('json').ids, true),
      }),
  )
  .get('/items/:id/file', zValidator('param', idSchema), async (c) => {
    const { item, buffer } = await studioManager.file(c.req.valid('param').id)
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': studioMimeType(item.format),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
  .patch(
    '/items/:id',
    zValidator('param', idSchema),
    zValidator('json', z.object({ pinned: z.boolean() })),
    async (c) =>
      c.json({
        success: true as const,
        data: await studioManager.pin(
          c.req.valid('param').id,
          c.req.valid('json').pinned,
        ),
      }),
  )
  .delete('/items/:id', zValidator('param', idSchema), async (c) =>
    c.json({
      success: true as const,
      data: await studioManager.remove([c.req.valid('param').id], false),
    }),
  )
  .post('/items/:id/archive', zValidator('param', idSchema), async (c) =>
    c.json({
      success: true as const,
      data: await studioManager.archive(c.req.valid('param').id),
    }),
  )
  .post('/items/:id/reference', zValidator('param', idSchema), async (c) =>
    c.json({
      success: true as const,
      data: await studioManager.reference(c.req.valid('param').id),
    }),
  )

export default studioApi
