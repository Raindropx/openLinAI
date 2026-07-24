import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getEndpointById, getYunwuApiKey } from '../common/config'
import { TaskTemplate, templateManager } from '../common/template-manager'
import { TRIAL_TEMPLATE_TITLE } from '../common/template-manager/enum'
import { handleChatImageGeneration } from '../module/gpt-image/chat-image'
import { handleImageGeneration } from '../module/gpt-image'
import { GPT_IMAGE_OUTPUT_MAX_N } from '../module/gpt-image/enum'
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

/** 校验模板 usageType 与端点 engine 是否匹配，不匹配返回错误信息 */
function checkEngineMatch(
  template: TaskTemplate | undefined,
  endpoint: { engine?: string },
): string | null {
  if (!template) return null
  const expectEngine =
    template.usageType === 'chat-image' ? 'chat-completions' : 'openai-images'
  const actualEngine = endpoint.engine || 'openai-images'
  if (expectEngine !== actualEngine) {
    return `该模板需要「${
      expectEngine === 'chat-completions' ? '聊天图片生成' : 'GPT 图片生成'
    }」引擎的端点，当前选中端点为「${
      actualEngine === 'chat-completions' ? '聊天图片生成' : 'GPT 图片生成'
    }」，请在设置中切换端点`
  }
  return null
}

const gptImageApi = new Hono()
  .get('/quota', async (c) => {
    // 按 endpointId 查端点；兼容老前端：未传 id 时回退到旧 yunwu key
    const endpointId = c.req.query('endpointId')
    const endpoint = endpointId ? getEndpointById(endpointId) : null

    // 无 endpointId 的旧入口：仅支持 yunwu
    if (!endpoint) {
      const apiKey = getYunwuApiKey()
      if (!apiKey) {
        return c.json(
          { success: false as const, error: 'API Key is not configured' },
          400,
        )
      }
      try {
        const response = await fetchWithTimeout(
          'https://yunwu.ai/api/usage/token/',
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          },
          15000,
        )
        const data: GPTImageQuotaResponse = await response.json()
        if (!response.ok || data.message) {
          return c.json(
            {
              success: false as const,
              error: data?.message || '获取余额失败',
            },
            500,
          )
        }
        return c.json({
          success: true as const,
          data: data,
        })
      } catch (error: any) {
        return c.json(
          { success: false as const, error: error.message || '获取余额失败' },
          500,
        )
      }
    }

    // 自定义端点不支持查余额
    if (endpoint.type === 'custom') {
      return c.json(
        {
          success: false as const,
          error: '[服务] 该端点不支持余额查询',
        },
        400,
      )
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

    // yunwu：走云雾专属 token 接口
    try {
      const response = await fetchWithTimeout(
        'https://yunwu.ai/api/usage/token/',
        {
          headers: {
            Authorization: `Bearer ${endpoint.apiKey}`,
          },
        },
        15000,
      )
      const data: GPTImageQuotaResponse = await response.json()
      if (!response.ok || data.message) {
        return c.json(
          {
            success: false as const,
            error: `[yunwu.ai] ${data?.message || '获取余额失败'}`,
          },
          500,
        )
      }
      return c.json({
        success: true as const,
        data: data,
      })
    } catch (error: any) {
      return c.json(
        { success: false as const, error: `[网络] ${error.message || '获取余额失败'}` },
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
      }),
    ),
    async (c) => {
      const { templateId, endpointId, size, quality } = c.req.valid('json')
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
      const engineError = checkEngineMatch(template, endpoint)
      if (engineError) {
        return c.json({ success: false as const, error: engineError }, 400)
      }
      if (endpoint.engine === 'chat-completions') {
        const result = await handleChatImageGeneration({
          apiKey: endpoint.apiKey,
          baseURL: endpoint.baseURL,
          model: endpoint.model,
          template,
          endpointName: endpoint.name,
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
          endpointName: endpoint.name,
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
