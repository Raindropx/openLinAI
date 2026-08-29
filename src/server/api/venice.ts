import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { listVeniceModels } from '../module/venice/models'

const modelTypeSchema = z.enum(['text', 'image', 'inpaint'])

function serializeModels(
  models: Awaited<ReturnType<typeof listVeniceModels>>,
) {
  return models.map((model) => ({
    id: model.id,
    type: model.type,
    name: model.model_spec?.name || model.id,
    privacy: model.model_spec?.privacy,
    constraints: model.model_spec?.constraints,
  }))
}

const veniceApi = new Hono()
  .get(
    '/models',
    zValidator('query', z.object({ type: modelTypeSchema })),
    async (c) => {
      try {
        const { type } = c.req.valid('query')
        const models = await listVeniceModels({ type })
        return c.json({ success: true as const, data: serializeModels(models) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ success: false as const, error: message }, 502)
      }
    },
  )
  .post(
    '/models',
    zValidator(
      'json',
      z.object({
        type: modelTypeSchema,
        apiKey: z.string().trim().min(1, 'Venice API Key is required'),
      }),
    ),
    async (c) => {
      const { type, apiKey } = c.req.valid('json')
      try {
        const models = await listVeniceModels({ type, apiKey })
        return c.json({ success: true as const, data: serializeModels(models) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ success: false as const, error: message }, 502)
      }
    },
  )

export default veniceApi
