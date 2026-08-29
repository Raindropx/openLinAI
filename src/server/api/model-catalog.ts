import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { listModelCatalog } from '../module/model-catalog'

const modelCatalogApi = new Hono().post(
  '/models',
  zValidator(
    'json',
    z.object({
      catalog: z.enum([
        'openai',
        'openai-image',
        'openai-vision-text',
        'openrouter-images',
        'venice-text',
        'venice-vision-text',
        'venice-image',
        'venice-inpaint',
      ]),
      baseURL: z.string().trim().min(1, 'API 地址不能为空'),
      apiKey: z.string().trim().min(1, 'API Key 不能为空'),
    }),
  ),
  async (c) => {
    try {
      const models = await listModelCatalog(c.req.valid('json'))
      return c.json({ success: true as const, data: models })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ success: false as const, error: message }, 502)
    }
  },
)

export default modelCatalogApi
