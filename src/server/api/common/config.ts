import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { BACKEND_PORT } from '../..'
import {
  DEFAULT_LLM_PROMPTS,
  getConfig,
  updateConfig,
} from '../../common/config'
import {
  clientConfig,
  preserveBalanceCredentials,
} from '../../common/config/client-config'
import { getLocalIpAddress } from '../utils/ip'

const configApi = new Hono()
  .get('/', (c) => {
    const ip = getLocalIpAddress()
    const localNetworkUrl = ip ? `http://${ip}:${BACKEND_PORT}` : null

    return c.json({
      success: true,
      data: {
        ...clientConfig(getConfig()),
        defaultLlmPrompts: DEFAULT_LLM_PROMPTS,
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
              editModel: z.string().optional(),
              apiKey: z.string(),
              type: z.enum([
                'yunwu',
                'openrouter',
                'venice',
                'laozhang',
                'custom',
              ]),
              balanceEnabled: z.boolean().optional(),
              balanceApiPath: z.string().optional(),
              balanceResultJsonKey: z.string().optional(),
              balanceAccessToken: z.string().trim().optional(),
              laozhangGptImage2Mode: z
                .enum(['per-call', 'official'])
                .optional(),
              laozhangQuality: z
                .enum(['low', 'medium', 'high', 'xhigh', 'max'])
                .optional(),
              laozhangTransparentBackground: z.boolean().optional(),
              spicyLoras: z
                .array(
                  z.object({
                    path: z
                      .url()
                      .refine((value) => /^https?:\/\//i.test(value)),
                    scale: z.number().finite().min(0).max(4),
                  }),
                )
                .optional(),
              spicySeed: z.number().int().min(0).max(2147483647).optional(),
              spicyResolution: z.enum(['1k', '1.5k', '2k']).optional(),
              groupRatio: z.number().finite().nonnegative().optional(),
              engine: z
                .enum([
                  'openai-images',
                  'openrouter-images',
                  'venice-images',
                  'novelai-images',
                  'apimart-images',
                  'spicyapi-images',
                  'laozhang-images',
                  'chat-completions',
                ])
                .optional(),
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
            novelaiFurryPrompt: z.string(),
            novelaiAnimePrompt: z.string(),
            novelaiInpaintFurryPrompt: z.string(),
            novelaiInpaintAnimePrompt: z.string(),
            styleOptimizePrompt: z.string(),
            charCardPrompt: z.string(),
          })
          .optional(),
      }),
    ),
    (c) => {
      const body = c.req.valid('json')
      if (body.endpoints) {
        body.endpoints = preserveBalanceCredentials(
          body.endpoints,
          getConfig().endpoints,
        )
      }
      const newConfig = updateConfig(body)
      const ip = getLocalIpAddress()
      const port = BACKEND_PORT
      const localNetworkUrl = `http://${ip}:${port}`

      return c.json({
        success: true,
        data: {
          ...clientConfig(newConfig),
          defaultLlmPrompts: DEFAULT_LLM_PROMPTS,
          localNetworkUrl,
        },
      })
    },
  )

export default configApi
