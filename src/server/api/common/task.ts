import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { taskFolderNameSchema } from '../../../shared/task-folders'
import { taskManager } from '../../common/task-manager'

const taskApi = new Hono()
  // Chain route declarations so Hono keeps the full client route map in AppType.
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
