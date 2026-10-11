import assert from 'node:assert/strict'
import { createResourceCache } from '../src/client/service/resources'

async function main() {
  const requests: { resolve: (value: number) => void; reject: (error: Error) => void }[] = []
  const cache = createResourceCache('tasks', 0, () => new Promise<number>((resolve, reject) => requests.push({ resolve, reject })))
  const first = cache.refreshAsync()
  const second = cache.refreshAsync()
  assert.equal(requests.length, 1, 'Overlapping reads serialize')
  requests[0].resolve(1)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(cache.getState().data, 0, 'Obsolete result is not published')
  assert.equal(requests.length, 2, 'Changes received during a read refresh once more')
  requests[1].resolve(2)
  await Promise.all([first, second])
  assert.equal(cache.getState().data, 2)
  const failed = cache.refreshAsync()
  requests[2].reject(new Error('Fixture failure'))
  await assert.rejects(failed, /Fixture failure/)
  assert.equal(cache.getState().data, 2, 'A failed refresh retains successful data')
  assert.equal(cache.getState().loading, false)
  const retry = cache.refreshAsync()
  requests[3].resolve(3)
  await retry
  assert.equal(cache.getState().data, 3)
  assert.equal(cache.getState().error, null)
  console.log('resource cache: serialized reads, stale response rejection, preserved successful state and retry passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
