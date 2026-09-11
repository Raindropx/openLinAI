import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'linai-billing-test-'),
  )
  process.env.DATA_DIR = dataDir
  const server = http.createServer((req, res) => {
    req.resume()
    res.setHeader('Content-Type', 'application/json')
    if (
      req.url === '/v1/images/generations' ||
      req.url === '/v1/images/edits'
    ) {
      const id = req.url.endsWith('edits') ? 'edit-id' : 'generation-id'
      res.setHeader('x-api-request-id', id)
      res.end(
        JSON.stringify({
          data: [
            {
              b64_json:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
            },
          ],
          usage: { input_tokens: 1701, output_tokens: 460, total_tokens: 2161 },
        }),
      )
    } else if (req.url === '/api/log/token') {
      res.end(
        JSON.stringify({
          success: true,
          data: ['generation-id', 'edit-id'].map((id) => ({
            type: 2,
            quota: 6152,
            group: 'Openai-Gpt-1',
            other: JSON.stringify({ request_id: id, group_ratio: 0.58824 }),
          })),
        }),
      )
    } else {
      res.statusCode = 404
      res.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    // Import only after isolating data, so tests never load real configuration/tasks.
    const { handleImageGeneration } =
      await import('../src/server/module/gpt-image')
    const { taskManager } = await import('../src/server/common/task-manager')
    const template = {
      id: 'test',
      title: 'Billing integration test',
      prompt: 'test',
      images: [] as string[],
      aspectRatio: '1:1',
      n: 1,
      usageType: 'image' as const,
      createdAt: Date.now(),
    }
    for (const edit of [false, true]) {
      if (edit) {
        await fs.writeFile(
          path.join(dataDir, 'images', 'input', 'reference.png'),
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
            'base64',
          ),
        )
        template.images = ['/api/static/images/input/reference.png']
      }
      const result = await handleImageGeneration({
        apiKey: 'sk-test',
        baseURL: `http://127.0.0.1:${port}/v1`,
        model: 'gpt-image-2',
        template,
        queryBilling: true,
        writeMetadata: false,
      })
      assert.equal(result.status, 200)
      for (let attempt = 0; attempt < 40; attempt++) {
        const tasks = await taskManager.getTasks()
        const task = tasks[tasks.length - 1]
        if (task.imageBilling?.status === 'actual') {
          assert.equal(task.imageBilling.cost, 0.012304)
          assert.equal(
            task.imageBilling.requestIds[0],
            edit ? 'edit-id' : 'generation-id',
          )
          assert.equal(task.gptTokenUsage.input_tokens, 1701)
          assert.equal(task.status, 'completed')
          break
        }
        assert.ok(attempt < 39, 'Bill did not arrive')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    console.log(
      'Image billing integration passed: SDK generate/edit headers -> saved task -> exact bill, using only a local mock provider.',
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    // This directory was created uniquely by this test, never a supplied path.
    await fs.rm(dataDir, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
