import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getEndpointById } from '../common/config'
import { TaskTemplate, templateManager } from '../common/template-manager'
import { TRIAL_TEMPLATE_TITLE } from '../common/template-manager/enum'
import { handleImageGeneration } from '../module/gpt-image'
import { handleChatImageGeneration } from '../module/gpt-image/chat-image'
import { GPT_IMAGE_OUTPUT_MAX_N } from '../module/gpt-image/enum'
import { handleOpenRouterImageGeneration } from '../module/gpt-image/openrouter-image'
import { fetchWithTimeout } from '../module/utils/fetch'

export interface GPTImageQuotaResponse {
  message: string
  data: {
    expires_at: number
    name: string
    total_available: number
    total_granted: number
    total_used: number
    unlimited_quota: boolean
  }
}

const DEFAULT_BALANCE_API_PATH = '/credits'
const DEFAULT_BALANCE_RESULT_JSON_KEY = 'data.total_usage'

function resolveBalanceUrl(baseURL: string, apiPath: string) {
  if (/^https?:\/\//i.test(apiPath)) return apiPath
  return `${baseURL.replace(/\/+$/, '')}/${apiPath.replace(/^\/+/, '')}`
}

function resolveNewApiBalanceUrl(baseURL: string) {
  const url = new URL(baseURL)
  url.search = ''
  url.hash = ''
  const basePath = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '')
  url.pathname = `${basePath}/api/usage/token/`.replace(/\/{2,}/g, '/')
  return url.toString()
}

function getJsonValueByPath(value: unknown, path: string): unknown {
  const keys = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((key) => key.trim())
    .filter(Boolean)

  return keys.reduce<unknown>((current, key) => {
    if (Array.isArray(current)) {
      const index = Number(key)
      return Number.isInteger(index) ? current[index] : undefined
    }
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, value)
}

function getResponseError(json: any) {
  if (typeof json?.error === 'string') return json.error
  if (typeof json?.error?.message === 'string') return json.error.message
  if (typeof json?.message === 'string') return json.message
  return '获取余额失败'
}

const gptImageApi = new Hono()
  .get('/quota', async (c) => {
    // 按 endpointId 查端点
    const endpointId = c.req.query('endpointId')
    const endpoint = endpointId ? getEndpointById(endpointId) : null

    if (!endpoint) {
      return c.json(
        { success: false as const, error: '请先选择有效的图片生成端点' },
        400,
      )
    }

    // 自定义端点：按端点配置请求余额并提取指定 JSON 键
    if (endpoint.type === 'custom') {
      if (!endpoint.balanceEnabled) {
        return c.json(
          {
            success: false as const,
            error: '[服务] 该端点未开启余额查询',
          },
          400,
        )
      }

      const apiPath =
        endpoint.balanceApiPath?.trim() || DEFAULT_BALANCE_API_PATH
      const resultJsonKey =
        endpoint.balanceResultJsonKey?.trim() ||
        DEFAULT_BALANCE_RESULT_JSON_KEY

      try {
        const response = await fetchWithTimeout(
          resolveBalanceUrl(endpoint.baseURL, apiPath),
          {
            headers: {
              Authorization: `Bearer ${endpoint.apiKey}`,
            },
          },
          15000,
        )
        const json: any = await response.json().catch(() => ({}))
        if (!response.ok) {
          return c.json(
            {
              success: false as const,
              error: getResponseError(json),
            },
            500,
          )
        }

        const rawBalance = getJsonValueByPath(json, resultJsonKey)
        const balance =
          typeof rawBalance === 'number'
            ? rawBalance
            : typeof rawBalance === 'string'
              ? Number(rawBalance.trim())
              : Number.NaN
        if (!Number.isFinite(balance)) {
          return c.json(
            {
              success: false as const,
              error: `结果 JSON 键“${resultJsonKey}”未返回有效数字`,
            },
            500,
          )
        }

        const normalized: GPTImageQuotaResponse = {
          message: '',
          data: {
            expires_at: -1,
            name: endpoint.name,
            total_granted: balance,
            total_used: 0,
            total_available: balance,
            unlimited_quota: false,
          },
        }
        return c.json({
          success: true as const,
          data: normalized,
        })
      } catch (error: any) {
        return c.json(
          { success: false as const, error: error.message || '获取余额失败' },
          500,
        )
      }
    }

    // OpenRouter：GET /api/v1/credits
    if (endpoint.type === 'openrouter') {
      try {
        const response = await fetchWithTimeout(
          'https://openrouter.ai/api/v1/credits',
          {
            headers: {
              Authorization: `Bearer ${endpoint.apiKey}`,
            },
          },
          15000,
        )
        const json: any = await response.json().catch(() => ({}))
        if (!response.ok) {
          return c.json(
            {
              success: false as const,
              error: json?.error || json?.message || '获取余额失败',
            },
            500,
          )
        }
        const totalCredits: number =
          json?.data?.total_credits ?? json?.total_credits ?? 0
        const totalUsage: number =
          json?.data?.total_usage ?? json?.total_usage ?? 0
        const normalized: GPTImageQuotaResponse = {
          message: '',
          data: {
            expires_at: -1,
            name: endpoint.name,
            total_granted: totalCredits,
            total_used: totalUsage,
            total_available: Math.max(0, totalCredits - totalUsage),
            unlimited_quota: false,
          },
        }
        return c.json({
          success: true as const,
          data: normalized,
        })
      } catch (error: any) {
        return c.json(
          { success: false as const, error: error.message || '获取余额失败' },
          500,
        )
      }
    }

    // New API：从生成 Base URL 推导站点根路径，查询当前令牌用量
    try {
      const response = await fetchWithTimeout(
        resolveNewApiBalanceUrl(endpoint.baseURL),
        {
          headers: {
            Authorization: `Bearer ${endpoint.apiKey}`,
          },
        },
        15000,
      )
      const json: any = await response.json().catch(() => ({}))
      if (!response.ok || json?.code === false || json?.success === false) {
        return c.json(
          {
            success: false as const,
            error: `[New API] ${getResponseError(json)}`,
          },
          500,
        )
      }

      const raw = json?.data
      const totalAvailable = Number(raw?.total_available)
      const totalUsed = Number(raw?.total_used ?? 0)
      const totalGranted = Number(
        raw?.total_granted ?? totalAvailable + totalUsed,
      )
      if (
        !Number.isFinite(totalAvailable) ||
        !Number.isFinite(totalUsed) ||
        !Number.isFinite(totalGranted)
      ) {
        return c.json(
          {
            success: false as const,
            error: '[New API] 响应中没有有效的令牌余额',
          },
          500,
        )
      }

      const normalized: GPTImageQuotaResponse = {
        message: '',
        data: {
          expires_at: Number(raw?.expires_at ?? 0),
          name: String(raw?.name || endpoint.name),
          total_granted: totalGranted,
          total_used: totalUsed,
          total_available: totalAvailable,
          unlimited_quota: Boolean(raw?.unlimited_quota),
        },
      }
      return c.json({
        success: true as const,
        data: normalized,
      })
    } catch (error: any) {
      return c.json(
        {
          success: false as const,
          error: `[New API] ${error.message || '获取余额失败'}`,
        },
        500,
      )
    }
  })
  .post(
    '/generate',
    zValidator(
      'json',
      z.object({
        templateId: z.string().min(1, 'Template ID is required'),
        endpointId: z.string().min(1, 'Endpoint ID is required'),
        size: z.enum(['1k', '2k', '4k']),
        quality: z.enum(['medium', 'high']),
        writeMetadata: z.boolean().optional().default(true),
      }),
    ),
    async (c) => {
      const { templateId, endpointId, size, quality, writeMetadata } =
        c.req.valid('json')
      const endpoint = getEndpointById(endpointId)
      if (!endpoint) {
        return c.json(
          { success: false as const, error: '[配置] Endpoint not found' },
          400,
        )
      }
      const templates = await templateManager.getTemplates()
      const template = templates.find((t) => t.id === templateId)
      if (!template) {
        return c.json(
          { success: false as const, error: '[服务] Template not found' },
          404,
        )
      }
      if (endpoint.engine === 'chat-completions') {
        const result = await handleChatImageGeneration({
          apiKey: endpoint.apiKey,
          baseURL: endpoint.baseURL,
          model: endpoint.model,
          template,
          size,
          quality,
          endpointName: endpoint.name,
          writeMetadata,
        })
        return c.json(result.data, result.status as any)
      }
      if (endpoint.engine === 'openrouter-images') {
        const result = await handleOpenRouterImageGeneration({
          apiKey: endpoint.apiKey,
          baseURL: endpoint.baseURL,
          model: endpoint.model,
          template,
          size,
          quality,
          endpointName: endpoint.name,
          writeMetadata,
        })
        return c.json(result.data, result.status as any)
      }
      const result = await handleImageGeneration({
        apiKey: endpoint.apiKey,
        baseURL: endpoint.baseURL,
        model: endpoint.model,
        template,
        size,
        quality,
        endpointName: endpoint.name,
        writeMetadata,
      })
      return c.json(result.data, result.status as any)
    },
  )
  .post(
    '/trial',
    zValidator(
      'json',
      z.object({
        prompt: z.string().min(1, 'Prompt is required'),
        endpointId: z.string().min(1, 'Endpoint ID is required'),
        aspectRatio: z.string().optional().default('1:1'),
        injectAspectRatio: z.boolean().optional(),
        images: z.array(z.string()).optional(),
        size: z.enum(['1k', '2k', '4k']).optional().default('1k'),
        quality: z.enum(['medium', 'high']).optional().default('medium'),
        n: z.number().min(1).max(GPT_IMAGE_OUTPUT_MAX_N).optional().default(1),
        writeMetadata: z.boolean().optional().default(true),
      }),
    ),
    async (c) => {
      const {
        prompt,
        endpointId,
        aspectRatio,
        injectAspectRatio,
        images,
        size,
        quality,
        n,
        writeMetadata,
      } = c.req.valid('json')
      const endpoint = getEndpointById(endpointId)
      if (!endpoint) {
        return c.json(
          { success: false as const, error: '[配置] Endpoint not found' },
          400,
        )
      }
      const isChat = endpoint.engine === 'chat-completions'
      const template: TaskTemplate = {
        id: uuidv4(),
        createdAt: Date.now(),
        prompt,
        aspectRatio,
        injectAspectRatio,
        usageType: isChat ? 'chat-image' : 'image',
        images: images || [],
        title: TRIAL_TEMPLATE_TITLE,
        n,
      }
      if (isChat) {
        const result = await handleChatImageGeneration({
          apiKey: endpoint.apiKey,
          baseURL: endpoint.baseURL,
          model: endpoint.model,
          template,
          size,
          quality,
          endpointName: endpoint.name,
          writeMetadata,
        })
        return c.json(result.data, result.status as any)
      }
      if (endpoint.engine === 'openrouter-images') {
        const result = await handleOpenRouterImageGeneration({
          apiKey: endpoint.apiKey,
          baseURL: endpoint.baseURL,
          model: endpoint.model,
          template,
          size,
          quality,
          endpointName: endpoint.name,
          writeMetadata,
        })
        return c.json(result.data, result.status as any)
      }
      const result = await handleImageGeneration({
        apiKey: endpoint.apiKey,
        baseURL: endpoint.baseURL,
        model: endpoint.model,
        template,
        size,
        quality,
        endpointName: endpoint.name,
        writeMetadata,
      })
      return c.json(result.data, result.status as any)
    },
  )
  .post(
    '/generate-api-key',
    zValidator(
      'json',
      z.object({
        systemToken: z.string().min(1, 'System Token is required'),
        userId: z.string().min(1, 'User ID is required'),
        name: z.string().min(1, 'Name is required'),
        quota: z.number().min(0, 'Quota must be a positive number'),
        group: z.string(),
      }),
    ),
    async (c) => {
      const { systemToken, userId, name, quota, group } = c.req.valid('json')
      try {
        const response = await fetchWithTimeout(
          'https://yunwu.ai/api/token/',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'new-api-user': userId,
              ...(systemToken ? { Authorization: systemToken } : {}),
            },
            body: JSON.stringify({
              remain_quota: quota * 1000000,
              expired_time: -1,
              unlimited_quota: false,
              model_limits_enabled: false,
              model_limits: '',
              group,
              mj_image_mode: 'default',
              mj_custom_proxy: '',
              selected_groups: [],
              name: name,
              allow_ips: '',
            }),
          },
          30000,
        )
        const data = await response.json()
        return c.json(
          data as { success?: boolean; data: string; message?: string },
        )
      } catch (error: any) {
        return c.json(
          {
            success: false as const,
            message: `[网络] ${error.message || '生成失败'}`,
            data: null,
          },
          500,
        )
      }
    },
  )

export default gptImageApi
