import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { BACKEND_PORT } from '../..'
import { getConfig, updateConfig } from '../../common/config'
import { getLocalIpAddress } from '../utils/ip'

const configApi = new Hono()
  .get('/', (c) => {
    const ip = getLocalIpAddress()
    const localNetworkUrl = ip ? `http://${ip}:${BACKEND_PORT}` : null

    return c.json({
      success: true,
      data: {
        ...getConfig(),
        localNetworkUrl,
      },
    })
  })
  .post(
    '/',
    zValidator(
      'json',
      z.object({
        gptImageApiKey: z.string().nullable().optional(),
        endpoints: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              baseURL: z.string(),
              model: z.string(),
              apiKey: z.string(),
              type: z.enum(['yunwu', 'openrouter', 'custom']),
              engine: z.enum(['openai-images', 'chat-completions']).optional(),
            }),
          )
          .optional(),
        llmEndpoints: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              baseURL: z.string(),
              model: z.string(),
              apiKey: z.string(),
            }),
          )
          .optional(),
        llmPrompts: z
          .object({
            optimizePrompt: z.string(),
            styleOptimizePrompt: z.string(),
            charCardPrompt: z.string(),
          })
          .optional(),
        ttsInworldApiKey: z.string().nullable().optional(),
      }),
    ),
    (c) => {
      const body = c.req.valid('json')
      const newConfig = updateConfig(body)
      const ip = getLocalIpAddress()
      const port = BACKEND_PORT
      const localNetworkUrl = `http://${ip}:${port}`

      return c.json({
        success: true,
        data: {
          ...newConfig,
          localNetworkUrl,
        },
      })
    },
  )

export default configApi
