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

    const { embedPngTextMetadata, readPngGenerationText } =
      await import('../src/server/module/gpt-image/generation-metadata')
    const nativeComment = JSON.stringify({ seed: 999, steps: 28, sampler: 'k_euler' })

    const requestBodies: Array<Record<string, any>> = []
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)))
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
      zip.file('image.png', embedPngTextMetadata(output, 'Comment', nativeComment))
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
    const requestBody = requestBodies[0]
    assert.equal(requestBody?.action, 'img2img')
    assert.equal(requestBody?.parameters.strength, 0.42)
    assert.equal(requestBody?.parameters.noise, 0.17)
    assert.equal(requestBody?.parameters.width, 768)
    assert.equal(requestBody?.parameters.height, 512)
    const normalized = Buffer.from(requestBody?.parameters.image, 'base64')
    const metadata = await sharp(normalized).metadata()
    assert.equal(metadata.width, 768)
    assert.equal(metadata.height, 512)

    const mask = await sharp({
      create: { width: 768, height: 512, channels: 3, background: '#000000' },
    }).png().toBuffer()
    const { default: studioApi } = await import('../src/server/api/studio')
    const uploadedMask = await studioApi.request('/providers/novelai/mask', {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(mask),
    })
    assert.equal(uploadedMask.status, 200)
    const maskUploadResult = await uploadedMask.json() as { data: { url: string } }
    assert.match(maskUploadResult.data.url, /^\/api\/static\/images\/input\/novelai-mask-/)
    assert.ok(await fs.pathExists(path.join(inputDirectory, maskUploadResult.data.url.split('/').pop()!)))
    const studioRequest = {
      title: '重绘测试', prompt: 'blue stone lion', negativePrompt: 'blur',
      model: 'nai-diffusion-4-5-full', width: 768, height: 512,
      steps: 28, scale: 5, cfgRescale: 0,
      sampler: 'k_euler' as const, noiseSchedule: 'karras' as const,
      seed: 101, n: 2, qualityToggle: true,
      action: 'infill' as const,
      referenceImageUrl: '/api/static/images/input/reference.png',
      maskImageUrl: maskUploadResult.data.url,
      strength: 0.65, noise: 0.1,
      characters: [{ prompt: 'guardian lion', negativePrompt: '', position: { x: 0.3, y: 0.55 } }],
      preciseReference: {
        imageUrl: '/api/static/images/input/reference.png',
        type: 'character' as const, strength: 0.8, fidelity: 0.6,
      },
    }
    const second = await handleNovelAIImageGeneration({
      apiKey: 'test-token', baseURL: 'https://image.novelai.net',
      model: studioRequest.model, endpointName: 'NovelAI Studio',
      template: {
        id: 'test-infill-template', title: studioRequest.title,
        prompt: studioRequest.prompt, images: [studioRequest.referenceImageUrl],
        usageType: 'image', aspectRatio: '3:2', n: 2, createdAt: Date.now(),
      },
      advanced: studioRequest, studioRequest,
    })
    assert.equal(second.data.success, true)
    assert.equal(requestBodies.length, 3)
    assert.equal(requestBodies[1].action, 'infill')
    assert.equal(requestBodies[1].model, 'nai-diffusion-4-5-full-inpainting')
    assert.equal(requestBodies[1].parameters.n_samples, 1)
    assert.equal(requestBodies[1].parameters.seed, 101)
    assert.equal(requestBodies[2].parameters.seed, 102)
    assert.equal(requestBodies[1].parameters.v4_prompt.use_coords, true)
    assert.deepEqual(requestBodies[1].parameters.v4_prompt.caption.char_captions[0].centers, [{ x: 0.3, y: 0.55 }])
    assert.equal(requestBodies[1].parameters.director_reference_images.length, 1)
    assert.equal((await sharp(Buffer.from(requestBodies[1].parameters.director_reference_images[0], 'base64')).metadata()).width, 1536)
    assert.equal((await sharp(Buffer.from(requestBodies[1].parameters.mask, 'base64')).metadata()).width, 768)
    const { taskManager } = await import('../src/server/common/task-manager')
    const saved = (await taskManager.getTasks()).find((task) => task.id === second.data.taskId)
    assert.equal(saved?.novelaiSnapshots?.length, 2)
    assert.equal(saved?.novelaiSnapshots?.[1].request.seed, 102)
    const { studioManager } = await import('../src/server/common/studio-manager')
    const shelf = await studioManager.fromTask(second.data.taskId, 1)
    assert.equal(shelf.provenance.novelai?.request.seed, 102)
    const imageFile = second.data.outputUrls?.[1]?.split('/').pop()
    assert.ok(imageFile)
    const generated = await fs.readFile(path.join(root, 'images', 'generated', imageFile))
    assert.equal(JSON.parse(readPngGenerationText(generated).Comment).novelai.seed, 102)
    let archivedComment = false
    for (let offset = 8; offset + 12 <= generated.length;) {
      const size = generated.readUInt32BE(offset)
      const kind = generated.toString('ascii', offset + 4, offset + 8)
      if (kind === 'liNa') {
        const archive = JSON.parse(generated.subarray(offset + 8, offset + 8 + size).toString('utf8'))
        archivedComment = archive.sourceTextChunks.some((entry: { keyword?: string; dataBase64: string }) =>
          entry.keyword === 'Comment' && Buffer.from(entry.dataBase64, 'base64').includes(Buffer.from(nativeComment)))
        break
      }
      offset += size + 12
    }
    assert.ok(archivedComment, 'NovelAI original Comment should survive in the PNG archive')
    const v5Request = { ...studioRequest, model: 'nai-diffusion-5-full', n: 1, preciseReference: undefined }
    const v5Result = await handleNovelAIImageGeneration({
      apiKey: 'test-token', baseURL: 'https://image.novelai.net',
      model: v5Request.model, endpointName: 'NovelAI Studio',
      writeMetadata: false,
      template: {
        id: 'test-v5-infill-template', title: v5Request.title,
        prompt: v5Request.prompt, images: [v5Request.referenceImageUrl],
        usageType: 'image', aspectRatio: '3:2', n: 1, createdAt: Date.now(),
      },
      advanced: v5Request,
    })
    assert.equal(v5Result.data.success, true)
    assert.equal(requestBodies[3].model, 'nai-diffusion-5-full-inpainting')
    globalThis.fetch = (async (_input, init) =>
      studioApi.request('/providers/novelai/generate', init)) as typeof fetch
    const { generateNovelAIStudioImages } = await import('../src/client/pages/common/Studio/api')
    await assert.rejects(
      generateNovelAIStudioImages({
        ...studioRequest,
        characters: [{ prompt: 'guardian lion', negativePrompt: '', position: {} as { x: number; y: number } }],
      }),
      /characters\.0\.position\.x: /,
    )
    console.log(
      'NovelAI regression: img2img, mask upload/infill, precise reference, positions, seeds, snapshots and PNG metadata passed',
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
