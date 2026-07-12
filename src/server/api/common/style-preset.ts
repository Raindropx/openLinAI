import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { stylePresetManager } from '../../common/style-preset-manager'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(20000),
  origin: z.enum(['custom', 'style-extract']).optional(),
})

const stylePresetApi = new Hono()
  .get('/', async (c) =>
    c.json({ success: true as const, data: await stylePresetManager.getAll() }),
  )
  .post('/', zValidator('json', bodySchema), async (c) => {
    const preset = await stylePresetManager.create(c.req.valid('json'))
    return c.json({ success: true as const, data: preset })
  })
  .put(
    '/:id',
    zValidator('param', z.object({ id: z.string() })),
    zValidator('json', bodySchema),
    async (c) => {
      const preset = await stylePresetManager.update(
        c.req.valid('param').id,
        c.req.valid('json'),
      )
      if (!preset) {
        return c.json({ success: false as const, error: '预设不存在' }, 404)
      }
      return c.json({ success: true as const, data: preset })
    },
  )
  .delete(
    '/:id',
    zValidator('param', z.object({ id: z.string() })),
    async (c) => {
      const deleted = await stylePresetManager.delete(c.req.valid('param').id)
      if (!deleted) {
        return c.json({ success: false as const, error: '预设不存在' }, 404)
      }
      return c.json({ success: true as const })
    },
  )

export default stylePresetApi
