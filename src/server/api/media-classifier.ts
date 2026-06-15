import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  deleteMediaImagePermanently,
  getAllMediaImages,
  getMediaWorkspaceSnapshot,
  readMediaImageBinary,
  setMediaWorkspace,
} from '../module/media-classifier'

const mediaClassifierApi = new Hono()
  .get('/workspace', async (c) => {
    try {
      return c.json({
        success: true,
        data: await getMediaWorkspaceSnapshot(),
      })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })
  .post(
    '/workspace',
    zValidator(
      'json',
      z.object({
        sourceDir: z.string(),
        resultDir: z.string(),
      }),
    ),
    async (c) => {
      try {
        const { sourceDir, resultDir } = c.req.valid('json')
        return c.json({
          success: true,
          data: await setMediaWorkspace(sourceDir, resultDir),
        })
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    },
  )
  .get('/images/all', async (c) => {
    try {
      return c.json({
        success: true,
        data: await getAllMediaImages(),
      })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })
  .post(
    '/trash/delete',
    zValidator(
      'json',
      z.object({
        relativePath: z.string(),
      }),
    ),
    async (c) => {
      try {
        const { relativePath } = c.req.valid('json')
        return c.json({
          success: true,
          data: await deleteMediaImagePermanently(relativePath),
        })
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    },
  )
  .get(
    '/image',
    zValidator(
      'query',
      z.object({
        relativePath: z.string(),
        thumb: z.string().optional(),
      }),
    ),
    async (c) => {
      try {
        const { relativePath, thumb } = c.req.valid('query')
        const file = await readMediaImageBinary(relativePath, thumb === 'true')
        return new Response(new Uint8Array(file.file), {
          headers: {
            'Content-Type': file.contentType,
            'Cache-Control': 'no-store',
          },
        })
      } catch (error: any) {
        if (error?.message === '图片不存在') {
          return c.json({ success: false, error: error.message }, 404)
        }

        return c.json({ success: false, error: error.message }, 500)
      }
    },
  )

export default mediaClassifierApi
