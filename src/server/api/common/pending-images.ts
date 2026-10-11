import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { changePendingImages, getPendingImages } from '../../common/pending-images'

export default new Hono()
  .get('/', async (c) => {
    c.header('Cache-Control', 'no-store')
    try { return c.json({ success: true as const, data: await getPendingImages() }) }
    catch (error) { return c.json({ success: false as const, error: (error as Error).message }, 500) }
  })
  .post('/', zValidator('json', z.object({ action: z.enum(['add', 'remove']), urls: z.array(z.string().max(500)).min(1).max(100) })), async (c) => {
    try {
      const { action, urls } = c.req.valid('json')
      return c.json({ success: true as const, data: await changePendingImages(action, urls) })
    } catch (error) { return c.json({ success: false as const, error: (error as Error).message }, 400) }
  })
