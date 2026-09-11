import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const imageBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
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
              b64_json: imageBase64,
            },
          ],
          usage: { input_tokens: 1701, output_tokens: 460, total_tokens: 2161 },
        }),
      )
    } else if (req.url === '/v1/images/models') {
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'google/test-image',
              supported_parameters: {
                n: { type: 'range', min: 1, max: 1 },
              },
            },
          ],
        }),
      )
    } else if (req.url === '/v1/models') {
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'tongyi-mai/z-image-turbo',
              aliases: ['zimage'],
              pricing: {
                currency: 'pollen',
                completionImageTokens: '0.004',
              },
            },
          ],
        }),
      )
    } else if (req.url === '/v1/images') {
      res.end(
        JSON.stringify({
          data: [{ b64_json: imageBase64 }],
          usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.004 },
        }),
      )
    } else if (req.url === '/v1/chat/completions') {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                images: [
                  `data:image/png;base64,${imageBase64}`,
                ],
              },
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 40, cost: 0.006 },
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
    const { handleOpenRouterImageGeneration } =
      await import('../src/server/module/gpt-image/openrouter-image')
    const { handleChatImageGeneration } =
      await import('../src/server/module/gpt-image/chat-image')
    const { estimatePollinationsImageBilling } =
      await import('../src/server/module/gpt-image/pollinations-billing')
    const { estimateVeniceImageCost } =
      await import('../src/server/module/gpt-image/venice-image')
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
        billingGroupRatio: 0.58824,
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

    template.images = []
    template.n = 2
    const openRouterResult = await handleOpenRouterImageGeneration({
      apiKey: 'test',
      baseURL: `http://127.0.0.1:${port}/v1`,
      model: 'google/test-image',
      template,
      writeMetadata: false,
    })
    assert.equal(openRouterResult.status, 200)
    let tasks = await taskManager.getTasks()
    let latestTask = tasks[tasks.length - 1]
    assert.equal(latestTask.imageBilling?.cost, 0.008)
    assert.equal(latestTask.imageBilling?.source, 'provider-response')
    assert.equal(latestTask.gptTokenUsage.total_tokens, 60)

    const chatResult = await handleChatImageGeneration({
      apiKey: 'test',
      baseURL: `http://127.0.0.1:${port}/v1`,
      model: 'google/test-image',
      template,
      writeMetadata: false,
    })
    assert.equal(chatResult.status, 200)
    tasks = await taskManager.getTasks()
    latestTask = tasks[tasks.length - 1]
    assert.equal(latestTask.imageBilling?.cost, 0.012)
    assert.equal(latestTask.imageBilling?.source, 'provider-response')
    assert.equal(latestTask.gptTokenUsage.total_tokens, 140)

    const pollinationsBill = await estimatePollinationsImageBilling({
      baseURL: `http://127.0.0.1:${port}/v1`,
      model: 'zimage',
      usage: undefined,
      imageCount: 3,
    })
    assert.equal(pollinationsBill?.currency, 'POLLEN')
    assert.equal(pollinationsBill?.cost, 0.012)
    assert.equal(pollinationsBill?.status, 'estimated')

    assert.equal(
      estimateVeniceImageCost({
        pricing: {
          resolutions: { '2K': { usd: 0.52 } },
          quality: { '2K': { medium: { usd: 0.14 } } },
          inputImages: { included: 1, additional: { usd: 0.01 } },
        },
        parameters: { resolution: '2K', quality: 'medium' },
        hasReferences: true,
        referenceCount: 3,
        completedRequests: 2,
      }),
      0.32,
    )
    console.log(
      'Image billing integration passed: OpenAI logs plus OpenRouter Images/chat response costs, using only a local mock provider.',
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
