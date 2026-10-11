import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  IMAGE_UPLOAD_REQUEST_MAX_BYTES,
  ImageUploadTooLargeError,
  deleteUnreferencedImages,
  getImageInfo,
  getThumbnailCacheStatus,
  listImages,
  openImageDirectory,
  serveImage,
  startThumbnailCacheRebuild,
  uploadInputImage,
} from '../../common/static'

const staticApi = new Hono()
  .get('/images/thumbnail-cache', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ success: true as const, data: getThumbnailCacheStatus() })
  })
  .post('/images/thumbnail-cache/rebuild', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(
      { success: true as const, data: startThumbnailCacheRebuild() },
      202,
    )
  })
  .post(
    '/images/upload',
    bodyLimit({
      maxSize: IMAGE_UPLOAD_REQUEST_MAX_BYTES,
      onError: (c) =>
        c.json(
          {
            success: false as const,
            error: '图片过大，请上传不超过 16 MiB 的图片',
          },
          413,
        ),
    }),
    zValidator(
      'json',
      z.object({
        image: z.string(),
        maxDimension: z.number().int().min(64).max(2048).optional(),
      }),
    ),
    async (c) => {
      const { image, maxDimension } = c.req.valid('json')

      try {
        const result = await uploadInputImage(image, { maxDimension })

        return c.json({
          success: true,
          url: result.url,
        })
      } catch (error: any) {
        if (!(error instanceof ImageUploadTooLargeError)) {
          console.error('Image upload failed:', error)
        }
        return c.json(
          {
            success: false as const,
            error: error?.message || 'Image processing failed',
          },
          error instanceof ImageUploadTooLargeError ? 413 : 500,
        )
      }
    },
  )
  .get(
    '/images/generated/:filename',
    zValidator('param', z.object({ filename: z.string() })),
    zValidator(
      'query',
      z.object({
        thumb: z.string().optional(),
        metadata: z.string().optional(),
      }),
    ),
    async (c) => {
      const { filename } = c.req.valid('param')
      const { thumb, metadata } = c.req.valid('query')
      if (metadata === 'true') {
        const info = await getImageInfo('generated', filename)
        if (!info) return c.notFound()
        c.header('Cache-Control', 'public, max-age=86400, immutable')
        return c.json(info)
      }

      const result = await serveImage({
        type: 'generated',
        filename,
        thumb: thumb === 'true',
        headOnly: c.req.method === 'HEAD',
      })

      if (!result) {
        return c.notFound()
      }

      return result
    },
  )
  .get(
    '/images/input/:filename',
    zValidator('param', z.object({ filename: z.string() })),
    zValidator(
      'query',
      z.object({
        thumb: z.string().optional(),
        metadata: z.string().optional(),
      }),
    ),
    async (c) => {
      const { filename } = c.req.valid('param')
      const { thumb, metadata } = c.req.valid('query')
      if (metadata === 'true') {
        const info = await getImageInfo('input', filename)
        if (!info) return c.notFound()
        c.header('Cache-Control', 'public, max-age=86400, immutable')
        return c.json(info)
      }

      const result = await serveImage({
        type: 'input',
        filename,
        thumb: thumb === 'true',
        headOnly: c.req.method === 'HEAD',
      })

      if (!result) {
        return c.notFound()
      }

      return result
    },
  )
  .post('/images/generated/open-dir', async (c) => {
    try {
      openImageDirectory('generated')
      return c.json({ success: true })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })
  .post('/images/input/open-dir', async (c) => {
    try {
      openImageDirectory('input')
      return c.json({ success: true })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })
  .post(
    '/images/delete-unreferenced',
    zValidator(
      'json',
      z.object({
        type: z.enum(['input', 'generated']),
        urls: z.array(z.string()).optional(),
      }),
    ),
    async (c) => {
      try {
        const { type, urls } = c.req.valid('json')
        const result = await deleteUnreferencedImages({ type, urls })

        return c.json({ success: true, ...result })
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    },
  )
  .get('/images/list', async (c) => {
    try {
      return c.json({ success: true, data: await listImages() })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })

export default staticApi
