import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { TASK_BACKUP_MAX_BYTES } from '../../../shared/task-backup'
import { taskFolderNameSchema } from '../../../shared/task-folders'
import {
  createTaskBackup,
  prepareTaskBackupDownload,
  restoreTaskBackup,
  restoreTaskBackupStream,
} from '../../common/task-backup'
import {
  getTaskDownloadStatus,
  prepareTaskDownload,
  streamTaskDownload,
} from '../../common/task-download'
import { taskManager } from '../../common/task-manager'

const taskApi = new Hono()
  // Chain route declarations so Hono keeps the full client route map in AppType.
  .post(
    '/backup-stream',
    zValidator(
      'json',
      z.object({
        downloadedTaskIds: z.array(z.string()).max(10000).optional(),
      }),
    ),
    async (c) => {
      try {
        return c.json({
          success: true as const,
          data: await prepareTaskBackupDownload(
            c.req.valid('json').downloadedTaskIds,
          ),
        })
      } catch (error) {
        return c.json(
          {
            success: false as const,
            error: error instanceof Error ? error.message : '备份任务列表失败',
          },
          400,
        )
      }
    },
  )
  // Do not use bodyLimit here: it buffers the request. The importer bounds the stream.
  .post('/restore-stream', async (c) => {
    try {
      if (!c.req.raw.body) throw new Error('备份 ZIP 无效或版本不受支持')
      return c.json({
        success: true as const,
        ...(await restoreTaskBackupStream(c.req.raw.body)),
      })
    } catch (error) {
      return c.json(
        {
          success: false as const,
          error: error instanceof Error ? error.message : '恢复任务列表失败',
        },
        400,
      )
    }
  })
  .post(
    '/download',
    bodyLimit({ maxSize: 1024 * 1024 }),
    zValidator(
      'json',
      z.object({
        ids: z.array(z.string().min(1).max(100)).min(1).max(10000),
        name: z.string().min(1).max(160),
        language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
      }),
    ),
    async (c) => {
      try {
        const { ids, name, language } = c.req.valid('json')
        return c.json({
          success: true as const,
          data: await prepareTaskDownload(ids, name, language),
        })
      } catch (error) {
        return c.json(
          {
            success: false as const,
            error: error instanceof Error ? error.message : '准备下载失败',
          },
          400,
        )
      }
    },
  )
  .get('/download/:token/status', (c) => {
    const data = getTaskDownloadStatus(c.req.param('token'))
    c.header('Cache-Control', 'no-store')
    return data
      ? c.json({ success: true as const, data })
      : c.json(
          { success: false as const, error: '下载请求已过期，请重试' },
          404,
        )
  })
  .get(
    '/download/:token',
    (c) =>
      streamTaskDownload(c.req.param('token'), c.req.method === 'HEAD') ??
      c.json({ success: false as const, error: '下载请求已过期，请重试' }, 404),
  )
  .post(
    '/backup',
    zValidator(
      'json',
      z.object({
        downloadedTaskIds: z.array(z.string()).max(10000).optional(),
      }),
    ),
    async (c) => {
      try {
        const archive = await createTaskBackup(
          c.req.valid('json').downloadedTaskIds,
        )
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        return c.body(new Uint8Array(archive), 200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="openLinAI-tasks-${timestamp}.zip"`,
          'Cache-Control': 'no-store',
        })
      } catch (error) {
        return c.json(
          {
            success: false as const,
            error: error instanceof Error ? error.message : '备份任务列表失败',
          },
          400,
        )
      }
    },
  )
  .post(
    '/restore',
    bodyLimit({
      maxSize: TASK_BACKUP_MAX_BYTES,
      onError: (c) =>
        c.json(
          { success: false as const, error: '备份 ZIP 不能超过 512 MiB' },
          413,
        ),
    }),
    async (c) => {
      try {
        const result = await restoreTaskBackup(
          Buffer.from(await c.req.arrayBuffer()),
        )
        return c.json({ success: true as const, ...result })
      } catch (error) {
        return c.json(
          {
            success: false as const,
            error: error instanceof Error ? error.message : '恢复任务列表失败',
          },
          400,
        )
      }
    },
  )
  .get('/', async (c) => {
    try {
      const tasks = await taskManager.getTasks()
      return c.json({
        success: true as const,
        data: tasks,
        folders: await taskManager.getFolders(),
      })
    } catch (error: any) {
      return c.json({ success: false as const, error: error.message }, 500)
    }
  })
  .get('/stream', (c) => {
    return streamSSE(c, async (stream) => {
      let aborted = false
      // Send initial tasks
      try {
        const initialTasks = await taskManager.getTasks()
        await stream.writeSSE({
          data: JSON.stringify({
            success: true,
            data: initialTasks,
            folders: await taskManager.getFolders(),
          }),
          event: 'message',
        })
      } catch (error: any) {
        await stream.writeSSE({
          data: JSON.stringify({ success: false, error: error.message }),
          event: 'error',
        })
      }

      // Listen for updates
      const listener = async (tasks: any[]) => {
        if (aborted) return
        try {
          await stream.writeSSE({
            data: JSON.stringify({
              success: true,
              data: tasks,
              folders: await taskManager.getFolders(),
            }),
            event: 'message',
          })
        } catch (e) {
          console.error('Failed to send SSE update:', e)
        }
      }

      taskManager.on('tasks-updated', listener)

      // Cleanup on disconnect
      stream.onAbort(() => {
        aborted = true
        taskManager.off('tasks-updated', listener)
      })

      // Keep connection alive
      while (!aborted) {
        await stream.sleep(30000)
        if (aborted) break
        try {
          await stream.writeSSE({
            data: 'ping',
            event: 'ping',
          })
        } catch (e) {
          break
        }
      }
    })
  })
  .post(
    '/folders',
    zValidator('json', z.object({ name: taskFolderNameSchema })),
    async (c) => {
      try {
        return c.json({
          success: true as const,
          data: await taskManager.saveFolder(c.req.valid('json').name),
        })
      } catch (error: any) {
        return c.json({ success: false as const, error: error.message }, 400)
      }
    },
  )
  .put(
    '/folders/:id',
    zValidator('json', z.object({ name: taskFolderNameSchema })),
    async (c) => {
      try {
        return c.json({
          success: true as const,
          data: await taskManager.saveFolder(
            c.req.valid('json').name,
            c.req.param('id'),
          ),
        })
      } catch (error: any) {
        return c.json({ success: false as const, error: error.message }, 400)
      }
    },
  )
  .delete('/folders/:id', async (c) => {
    try {
      await taskManager.deleteFolder(c.req.param('id'))
      return c.json({ success: true as const })
    } catch (error: any) {
      return c.json({ success: false as const, error: error.message }, 400)
    }
  })
  .put(
    '/move',
    zValidator(
      'json',
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(10000),
        folderId: z.string().optional(),
      }),
    ),
    async (c) => {
      try {
        const { ids, folderId } = c.req.valid('json')
        return c.json({
          success: true as const,
          count: await taskManager.moveTasks(ids, folderId),
        })
      } catch (error: any) {
        return c.json({ success: false as const, error: error.message }, 400)
      }
    },
  )
  .delete(
    '/:id/images/:index',
    zValidator(
      'param',
      z.object({
        id: z.string(),
        index: z.coerce.number().int().nonnegative(),
      }),
    ),
    async (c) => {
      try {
        const { id, index } = c.req.valid('param')
        const result = await taskManager.deleteTaskImage(id, index)
        if (!result.success) {
          return c.json(
            {
              success: false as const,
              error: result.error || 'Failed to delete task image',
            },
            404,
          )
        }
        return c.json({ success: true as const })
      } catch (error: any) {
        return c.json({ success: false as const, error: error.message }, 500)
      }
    },
  )
  .delete(
    '/:id',
    zValidator('param', z.object({ id: z.string() })),
    zValidator('query', z.object({ keepImage: z.string().optional() })),
    async (c) => {
      try {
        const { id } = c.req.valid('param')
        const { keepImage } = c.req.valid('query')
        const result = await taskManager.deleteTask(id, keepImage === 'true')
        if (!result.success) {
          return c.json(
            {
              success: false as const,
              error: result.error || 'Failed to delete task',
            },
            404,
          )
        }
        return c.json({ success: true as const })
      } catch (error: any) {
        return c.json({ success: false as const, error: error.message }, 500)
      }
    },
  )

export default taskApi
