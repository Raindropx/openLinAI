import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { characterCardManager } from '../../common/character-card-manager'
import {
  IMAGE_UPLOAD_MAX_BYTES,
  IMAGE_UPLOAD_REQUEST_MAX_BYTES,
} from '../../common/static'

const CHARACTER_CARD_DATA_MAX_BYTES = IMAGE_UPLOAD_MAX_BYTES
const CHARACTER_CARD_REQUEST_MAX_BYTES =
  IMAGE_UPLOAD_REQUEST_MAX_BYTES + CHARACTER_CARD_DATA_MAX_BYTES

const cardBodySchema = z
  .object({
    name: z.string().max(200),
    format: z.enum(['json', 'png']),
    card: z.record(z.string(), z.unknown()),
    pngData: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (
      Buffer.byteLength(JSON.stringify(value.card), 'utf-8') >
      CHARACTER_CARD_DATA_MAX_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['card'],
        message: '角色卡数据不能超过 16 MiB',
      })
    }
    if (value.format === 'png' && !value.pngData) {
      context.addIssue({
        code: 'custom',
        path: ['pngData'],
        message: '保存 PNG 角色卡需要角色图片',
      })
    }
  })

const characterCardApi = new Hono()
  .get('/', async (c) => {
    try {
      return c.json({
        success: true as const,
        data: await characterCardManager.getAll(),
      })
    } catch (error) {
      return c.json(
        {
          success: false as const,
          error:
            error instanceof Error ? error.message : '获取角色卡列表失败',
        },
        500,
      )
    }
  })
  .post(
    '/',
    bodyLimit({
      maxSize: CHARACTER_CARD_REQUEST_MAX_BYTES,
      onError: (c) =>
        c.json(
          {
            success: false as const,
            error: '角色卡请求过大（PNG 与角色卡数据分别不能超过 16 MiB）',
          },
          413,
        ),
    }),
    zValidator('json', cardBodySchema),
    async (c) => {
      try {
        const card = await characterCardManager.create(c.req.valid('json'))
        return c.json({ success: true as const, data: card })
      } catch (error) {
        return c.json(
          {
            success: false as const,
            error: error instanceof Error ? error.message : '保存角色卡失败',
          },
          500,
        )
      }
    },
  )
  .get(
    '/:id/image',
    zValidator('param', z.object({ id: z.string() })),
    async (c) => {
      const image = await characterCardManager.getImage(c.req.valid('param').id)
      if (!image) return c.notFound()
      return new Response(new Uint8Array(image), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-cache',
        },
      })
    },
  )
  .put(
    '/:id',
    bodyLimit({
      maxSize: CHARACTER_CARD_REQUEST_MAX_BYTES,
      onError: (c) =>
        c.json(
          {
            success: false as const,
            error: '角色卡请求过大（PNG 与角色卡数据分别不能超过 16 MiB）',
          },
          413,
        ),
    }),
    zValidator('param', z.object({ id: z.string() })),
    zValidator('json', cardBodySchema),
    async (c) => {
      try {
        const card = await characterCardManager.update(
          c.req.valid('param').id,
          c.req.valid('json'),
        )
        if (!card) {
          return c.json({ success: false as const, error: '角色卡不存在' }, 404)
        }
        return c.json({ success: true as const, data: card })
      } catch (error) {
        return c.json(
          {
            success: false as const,
            error: error instanceof Error ? error.message : '更新角色卡失败',
          },
          500,
        )
      }
    },
  )
  .delete(
    '/:id',
    zValidator('param', z.object({ id: z.string() })),
    async (c) => {
      const deleted = await characterCardManager.delete(c.req.valid('param').id)
      if (!deleted) {
        return c.json({ success: false as const, error: '角色卡不存在' }, 404)
      }
      return c.json({ success: true as const })
    },
  )

export default characterCardApi
