import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  deleteMediaImagePermanently,
  getAllMediaImages,
  getMediaImages,
  getMediaWorkspaceSnapshot,
  markMediaImage,
  pickMediaDirectory,
  readMediaImageBinary,
  restoreMediaImage,
  setMediaWorkspace,
} from '../module/media-classifier'

const mediaStageSchema = z.enum(['original', 'screened', 'classified', 'trash'])
const mediaStatusSchema = z.enum(['pending', 'keep', 'delete'])
const workspaceKindSchema = z.enum(['source', 'result'])

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
    '/workspace/select-folder',
    zValidator(
      'json',
      z.object({
        kind: workspaceKindSchema,
        initialPath: z.string().optional(),
      }),
    ),
    async (c) => {
      try {
        const { kind, initialPath } = c.req.valid('json')
        const selectedPath = await pickMediaDirectory(kind, initialPath)
        return c.json({
          success: true,
          data: { path: selectedPath },
        })
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    },
  )
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
  .get(
    '/images',
    zValidator(
      'query',
      z.object({
        stage: mediaStageSchema,
        page: z.coerce.number().optional().default(1),
        pageSize: z.coerce.number().optional().default(24),
      }),
    ),
    async (c) => {
      try {
        const { stage, page, pageSize } = c.req.valid('query')
        return c.json({
          success: true,
          data: await getMediaImages(stage, page, pageSize),
        })
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    },
  )
  .get(
    '/images/all',
    zValidator(
      'query',
      z.object({
        stage: mediaStageSchema,
      }),
    ),
    async (c) => {
      try {
        const { stage } = c.req.valid('query')
        return c.json({
          success: true,
          data: await getAllMediaImages(stage),
        })
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    },
  )
  .post(
    '/images/mark',
    zValidator(
      'json',
      z.object({
        relativePath: z.string(),
        status: mediaStatusSchema,
      }),
    ),
    async (c) => {
      try {
        const { relativePath, status } = c.req.valid('json')
        return c.json({
          success: true,
          data: await markMediaImage(relativePath, status),
        })
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    },
  )
  .post(
    '/trash/restore',
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
          data: await restoreMediaImage(relativePath),
        })
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    },
  )
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
