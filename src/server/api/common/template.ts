import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { templateManager } from '../../common/template-manager'
import { GPT_IMAGE_OUTPUT_MAX_N } from '../../module/gpt-image/enum'

const templateApi = new Hono()
  // Chain route declarations so Hono preserves the route type for the client.
  .get('/', async (c) => {
    try {
      const templates = await templateManager.getTemplates()
      return c.json({ success: true as const, data: templates })
    } catch (error: any) {
      return c.json({ success: false as const, error: error.message }, 500)
    }
  })
  .post(
    '/',
    zValidator(
      'json',
      z.object({
        title: z.string().optional(),
        images: z.array(z.string()),
        prompt: z.string(),
        usageType: z.enum(['image', 'video', 'chat-image']),
        aspectRatio: z.string().optional(),
        injectAspectRatio: z.boolean().optional(),
        folder: z.string().optional(),
        n: z.number().min(1).max(GPT_IMAGE_OUTPUT_MAX_N).optional(),
      }),
    ),
    async (c) => {
      try {
        const body = c.req.valid('json')
        const newTemplate = await templateManager.addTemplate(body)
        return c.json({ success: true as const, data: newTemplate })
      } catch (error: any) {
        return c.json({ success: false as const, error: error.message }, 500)
      }
    },
  )
  .put(
    '/folder/rename',
    zValidator(
      'json',
      z
        .object({
          oldFolder: z.string().min(1),
          newFolder: z
            .string()
            .trim()
            .min(1, '文件夹名称不能为空')
            .max(100, '文件夹名称不能超过 100 个字符'),
        })
        .refine(({ oldFolder, newFolder }) => oldFolder !== newFolder, {
          message: '新名称不能与原名称相同',
          path: ['newFolder'],
        }),
    ),
    async (c) => {
      try {
        const { oldFolder, newFolder } = c.req.valid('json')
        const result = await templateManager.renameFolder(
          oldFolder,
          newFolder,
        )
        if (result.status === 'not-found') {
          return c.json(
            { success: false as const, error: '原文件夹不存在' },
            404,
          )
        }
        if (result.status === 'conflict') {
          return c.json(
            { success: false as const, error: '已存在同名文件夹' },
            409,
          )
        }
        if (result.status === 'same-name') {
          return c.json(
            { success: false as const, error: '新名称不能与原名称相同' },
            409,
          )
        }
        return c.json({
          success: true as const,
          data: {
            updatedCount: result.updatedCount,
            newFolder: result.newFolder,
          },
        })
      } catch (error: any) {
        return c.json({ success: false as const, error: error.message }, 500)
      }
    },
  )
  .delete(
    '/:id',
    zValidator('param', z.object({ id: z.string() })),
    async (c) => {
      try {
        const { id } = c.req.valid('param')
        const success = await templateManager.deleteTemplate(id)
        if (!success) {
          return c.json(
            { success: false as const, error: 'Template not found' },
            404,
          )
        }
        return c.json({ success: true as const })
      } catch (error: any) {
        return c.json({ success: false as const, error: error.message }, 500)
      }
    },
  )
  .put(
    '/:id',
    zValidator('param', z.object({ id: z.string() })),
    zValidator(
      'json',
      z.object({
        title: z.string().optional(),
        prompt: z.string().optional(),
        aspectRatio: z.string().optional(),
        injectAspectRatio: z.boolean().optional(),
        folder: z.string().optional(),
        images: z.array(z.string()).optional(),
        n: z.number().min(1).max(GPT_IMAGE_OUTPUT_MAX_N).optional(),
      }),
    ),
    async (c) => {
      try {
        const { id } = c.req.valid('param')
        const updates = c.req.valid('json')
        const updatedTemplate = await templateManager.updateTemplate(
          id,
          updates,
        )
        if (!updatedTemplate) {
          return c.json(
            { success: false as const, error: 'Template not found' },
            404,
          )
        }
        return c.json({ success: true as const, data: updatedTemplate })
      } catch (error: any) {
        return c.json({ success: false as const, error: error.message }, 500)
      }
    },
  )

export default templateApi
