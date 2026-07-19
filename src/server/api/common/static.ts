import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  IMAGE_UPLOAD_REQUEST_MAX_BYTES,
  ImageUploadTooLargeError,
  deleteUnreferencedImages,
  listImages,
  openImageDirectory,
  serveImage,
  uploadInputImage,
} from '../../common/static'

const staticApi = new Hono()
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
    zValidator('json', z.object({ image: z.string() })),
    async (c) => {
      const { image } = c.req.valid('json')

      try {
        const result = await uploadInputImage(image)

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
    zValidator('query', z.object({ thumb: z.string().optional() })),
    async (c) => {
      const { filename } = c.req.valid('param')
      const { thumb } = c.req.valid('query')

      const result = await serveImage({
        type: 'generated',
        filename,
        thumb: thumb === 'true',
      })

      if (!result) {
        return c.notFound()
      }

      return new Response(new Uint8Array(result.file), {
        headers: {
          'Content-Type': result.contentType,
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      })
    },
  )
  .get(
    '/images/input/:filename',
    zValidator('param', z.object({ filename: z.string() })),
    zValidator('query', z.object({ thumb: z.string().optional() })),
    async (c) => {
      const { filename } = c.req.valid('param')
      const { thumb } = c.req.valid('query')

      const result = await serveImage({
        type: 'input',
        filename,
        thumb: thumb === 'true',
      })

      if (!result) {
        return c.notFound()
      }

      return new Response(new Uint8Array(result.file), {
        headers: {
          'Content-Type': result.contentType,
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      })
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
