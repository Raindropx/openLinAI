import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-anlas-'))
  const originalFetch = globalThis.fetch
  const previousDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = root
  try {
    const { fetchNovelAIAnlas } = await import('../src/server/module/gpt-image/novelai-balance')
    let result: unknown = { trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 25 } }
    let status = 200
    globalThis.fetch = (async (url, init) => {
      assert.equal(String(url), 'https://image.example.test/user/subscription')
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token')
      return new Response(JSON.stringify(result), { status })
    }) as typeof fetch
    assert.equal(await fetchNovelAIAnlas('https://image.example.test/', 'test-token'), 125)
    result = { trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 } }
    assert.equal(await fetchNovelAIAnlas('https://image.example.test', 'test-token'), 0)
    for (const invalid of [{}, { trainingStepsLeft: { fixedTrainingStepsLeft: '100', purchasedTrainingSteps: 2 } }]) {
      result = invalid
      await assert.rejects(fetchNovelAIAnlas('https://image.example.test', 'test-token'), /余额响应格式不正确/)
    }
    status = 401
    result = { error: 'Invalid token' }
    await assert.rejects(fetchNovelAIAnlas('https://image.example.test', 'test-token'), /Invalid token/)

    const { updateConfig } = await import('../src/server/common/config')
    const endpoint = { id: 'novelai-test', name: 'NovelAI Test', type: 'novelai' as const, engine: 'novelai-images' as const,
      baseURL: 'https://image.example.test', apiKey: 'test-token', model: 'nai-diffusion-5-full' }
    updateConfig({ endpoints: [endpoint] })
    const { default: api } = await import('../src/server/api/gpt-image')
    status = 200
    result = { trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 25 } }
    const response = await api.request('/quota?endpointId=novelai-test')
    assert.equal(response.status, 200)
    const json = await response.json()
    assert.equal(json.success, true)
    assert.equal(json.data.data.total_available, 125)
    assert.deepEqual(json.data.data.balances, { Anlas: 125 })
    status = 401
    result = { error: 'Invalid token' }
    const failed = await api.request('/quota?endpointId=novelai-test')
    assert.equal(failed.status, 500)
    assert.equal((await failed.json()).success, false)

    const { taskBackupSchema } = await import('../src/shared/task-backup')
    const endpointSchema = taskBackupSchema.shape.endpoints.element
    assert.equal(endpointSchema.parse(endpoint).type, 'novelai')
    console.log('NovelAI balance checks passed: sum, zero, invalid response, auth failure, quota route, backup type.')
  } finally {
    globalThis.fetch = originalFetch
    if (previousDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDir
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
