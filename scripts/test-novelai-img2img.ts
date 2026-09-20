import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import JSZip from 'jszip'
import sharp from 'sharp'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-novelai-i2i-'))
  const originalFetch = globalThis.fetch
  process.env.DATA_DIR = root

  try {
    const { calculateNovelAIImg2ImgSize } =
      await import('../src/shared/studio-generation')
    assert.deepEqual(calculateNovelAIImg2ImgSize(1024, 1024), {
      width: 1024,
      height: 1024,
    })
    const landscapeSize = calculateNovelAIImg2ImgSize(1920, 1080)
    const portraitSize = calculateNovelAIImg2ImgSize(1080, 1920)
    assert.deepEqual(portraitSize, {
      width: landscapeSize.height,
      height: landscapeSize.width,
    })
    assert.equal(landscapeSize.width % 64, 0)
    assert.equal(landscapeSize.height % 64, 0)
    assert.ok(landscapeSize.width * landscapeSize.height <= 1024 * 1024)
    assert.ok(
      Math.abs(landscapeSize.width / landscapeSize.height - 16 / 9) < 0.05,
    )

    const inputDirectory = path.join(root, 'images', 'input')
    await fs.ensureDir(inputDirectory)
    const reference = await sharp({
      create: { width: 96, height: 64, channels: 4, background: '#287ca8' },
    })
      .png()
      .toBuffer()
    await fs.writeFile(path.join(inputDirectory, 'reference.png'), reference)

    let requestBody: Record<string, any> | undefined
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body))
      const output = await sharp({
        create: {
          width: 768,
          height: 512,
          channels: 4,
          background: '#8a4fbd',
        },
      })
        .png()
        .toBuffer()
      const zip = new JSZip()
      zip.file('image.png', output)
      const body = await zip.generateAsync({ type: 'nodebuffer' })
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      })
    }) as typeof fetch

    const { handleNovelAIImageGeneration } =
      await import('../src/server/module/gpt-image/novelai-image')
    const result = await handleNovelAIImageGeneration({
      apiKey: 'test-token',
      baseURL: 'https://image.novelai.net',
      model: 'nai-diffusion-5-full',
      endpointName: 'NovelAI Studio',
      writeMetadata: false,
      template: {
        id: 'test-template',
        title: 'NovelAI img2img regression',
        prompt: 'blue stone lion',
        images: ['/api/static/images/input/reference.png'],
        usageType: 'image',
        aspectRatio: '3:2',
        n: 1,
        createdAt: Date.now(),
      },
      advanced: {
        negativePrompt: '',
        width: 768,
        height: 512,
        steps: 28,
        scale: 5,
        cfgRescale: 0,
        sampler: 'k_euler',
        noiseSchedule: 'karras',
        seed: 42,
        n: 1,
        qualityToggle: false,
        referenceImageUrl: '/api/static/images/input/reference.png',
        strength: 0.42,
        noise: 0.17,
        characters: [],
      },
    })

    assert.equal(result.status, 200)
    assert.equal(result.data.success, true)
    assert.equal(requestBody?.action, 'img2img')
    assert.equal(requestBody?.parameters.strength, 0.42)
    assert.equal(requestBody?.parameters.noise, 0.17)
    assert.equal(requestBody?.parameters.width, 768)
    assert.equal(requestBody?.parameters.height, 512)
    const normalized = Buffer.from(requestBody?.parameters.image, 'base64')
    const metadata = await sharp(normalized).metadata()
    assert.equal(metadata.width, 768)
    assert.equal(metadata.height, 512)
    console.log(
      'NovelAI img2img regression: auto aspect size, action, strength/noise, exact-size bitmap and bare Base64 passed',
    )
  } finally {
    globalThis.fetch = originalFetch
    await fs.remove(root)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
