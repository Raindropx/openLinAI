import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { logger } from '../../module/utils/logger'

const logApi = new Hono()
  .get(
    '/:moduleId',
    zValidator('param', z.object({ moduleId: z.string() })),
    (c) => {
      return streamSSE(c, async (stream) => {
        let aborted = false

        // 发送初始日志
        const initialLogs = logger.getLogs(100)
        for (const log of initialLogs) {
          await stream.writeSSE({
            data: log,
            event: 'log',
          })
        }

        // 监听新日志
        const onLog = async (message: string) => {
          if (aborted) return
          try {
            await stream.writeSSE({
              data: message,
              event: 'log',
            })
          } catch (e) {
            // 流可能已关闭
            logger.removeListener('log', onLog)
          }
        }

        logger.on('log', onLog)

        // 客户端断开时清理
        stream.onAbort(() => {
          aborted = true
          logger.removeListener('log', onLog)
        })

        // 保持连接，定期发送心跳
        while (!aborted) {
          await stream.sleep(30000)
          if (aborted) break
          try {
            await stream.writeSSE({ data: 'ping', event: 'ping' })
          } catch {
            break
          }
        }
      })
    },
  )
  .delete(
    '/:moduleId',
    zValidator('param', z.object({ moduleId: z.string() })),
    (c) => {
      logger.clearLogs()
      return c.json({ success: true as const })
    },
  )

export default logApi
