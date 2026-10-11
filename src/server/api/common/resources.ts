import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { subscribeResources } from '../../common/resource-events'

export default new Hono().get('/events', (c) => streamSSE(c, async (stream) => {
  let closed = false
  let pending = new Map<string, number>()
  let writing = false
  const flush = async () => {
    if (writing || closed) return
    writing = true
    try {
      while (pending.size && !closed) {
        const batch = [...pending].map(([resource, revision]) => ({ resource, revision }))
        pending.clear()
        await stream.writeSSE({ event: 'change', data: JSON.stringify(batch) })
      }
    } catch { closed = true } finally { writing = false }
  }
  const unsubscribe = subscribeResources(({ resource, revision }) => {
    pending.set(resource, revision)
    void flush()
  })
  stream.onAbort(() => { closed = true; pending.clear(); unsubscribe() })
  try {
    await stream.writeSSE({ event: 'ready', data: '{}' })
    while (!closed) {
      await stream.sleep(15000)
      if (!closed) await stream.writeSSE({ event: 'ping', data: '{}' })
    }
  } finally { closed = true; unsubscribe() }
}))
