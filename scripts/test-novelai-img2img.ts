import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
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
      const requestBody = JSON.parse(String(init?.body))
      requestBodies.push(requestBody)
      const output = await sharp({
        create: {
          width: requestBody.parameters.width,
          height: requestBody.parameters.height,
          channels: 4,
          background: requestBody.action === 'infill' ? '#8a4fbd80' : '#8a4fbd',
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
    }).composite([{ input: await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#ffffff' },
    }).png().toBuffer(), left: 100, top: 100 }]).png().toBuffer()
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
    assert.deepEqual(requestBodies[1].parameters.img2img, {
      strength: 0.65, noise: 0.1, extra_noise_seed: 101,
    })
    assert.equal(requestBodies[1].parameters.add_original_image, true)
    assert.equal(requestBodies[2].parameters.img2img.extra_noise_seed, 102)
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
    const pixels = (await sharp(generated).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data
    assert.equal(pixels[(150 * 768 + 150) * 4 + 3], 255)
    assert.equal(pixels[(300 * 768 + 300) * 4 + 3], 128)
    const { makeNovelAIInpaintOpaque } = await import('../src/server/module/gpt-image/novelai-inpaint-result')
    assert.equal(makeNovelAIInpaintOpaque(generated, mask, 'transparent background'), generated)
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
    const focusedResult = await handleNovelAIImageGeneration({
      apiKey: 'test-token', baseURL: 'https://image.novelai.net',
      model: 'nai-diffusion-5-full', endpointName: 'NovelAI Studio',
      writeMetadata: false,
      template: {
        id: 'test-focused-infill-template', title: '聚焦重绘测试',
        prompt: 'purple fur', images: [studioRequest.referenceImageUrl],
        usageType: 'image', aspectRatio: '3:2', n: 1, createdAt: Date.now(),
      },
      advanced: {
        ...studioRequest,
        model: 'nai-diffusion-5-full', n: 1, preciseReference: undefined,
        focusedInpaint: true, inpaintContextPixels: 64,
      },
    })
    assert.equal(focusedResult.data.success, true)
    const focusedBody = requestBodies[4]
    assert.equal(focusedBody.action, 'infill')
    assert.equal(focusedBody.parameters.width, 1024)
    assert.equal(focusedBody.parameters.height, 1024)
    assert.equal(focusedBody.parameters.add_original_image, false)
    assert.equal((await sharp(Buffer.from(focusedBody.parameters.mask, 'base64')).metadata()).width, 1024)
    const focusedFile = focusedResult.data.outputUrls?.[0]?.split('/').pop()
    assert.ok(focusedFile)
    const focusedGenerated = await fs.readFile(path.join(root, 'images', 'generated', focusedFile))
    assert.equal(JSON.parse(readPngGenerationText(focusedGenerated).Comment).seed, 999)
    const focusedPixels = (await sharp(path.join(root, 'images', 'generated', focusedFile))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data
    const rgbaAt = (x: number, y: number) => Array.from(focusedPixels.subarray((y * 768 + x) * 4, (y * 768 + x) * 4 + 4))
    const sourcePixels = (await sharp(normalized).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data
    const sourceAt = (x: number, y: number) => Array.from(sourcePixels.subarray((y * 768 + x) * 4, (y * 768 + x) * 4 + 4))
    assert.ok(rgbaAt(50, 50).every((value, channel) => Math.abs(value - sourceAt(50, 50)[channel]) <= 1),
      'outside the mask must match the decoded source (JPEG decoders may differ by one level)')
    assert.equal(rgbaAt(150, 150)[3], 255, 'mask interior should remain opaque')
    const difference = (x: number, y: number) => rgbaAt(x, y)
      .slice(0, 3).reduce((sum, value, channel) => sum + Math.abs(value - sourceAt(x, y)[channel]), 0)
    assert.ok(difference(150, 150) > 30, 'mask interior should use the generated result')
    assert.ok(difference(100, 150) < difference(150, 150), 'mask edge should be feathered')
    const { prepareFocusedInpaint, compositeFocusedInpaint } =
      await import('../src/server/module/gpt-image/novelai-focused-inpaint')
    const focus = await prepareFocusedInpaint(normalized, mask, 768, 512, 64)
    assert.ok(focus)
    const synthetic = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#8a4fbd' } }).png().toBuffer()
    const narrow = await compositeFocusedInpaint(normalized, synthetic, mask, 768, 512, focus, false, 4)
    const wide = await compositeFocusedInpaint(normalized, synthetic, mask, 768, 512, focus, false, 20)
    const narrowPixels = await sharp(narrow).raw().toBuffer()
    const widePixels = await sharp(wide).raw().toBuffer()
    const pixelDifference = (pixels: Buffer, x: number, y: number) =>
      [0, 1, 2].reduce((sum, channel) => sum + Math.abs(pixels[(y * 768 + x) * 4 + channel] - sourceAt(x, y)[channel]), 0)
    assert.ok(pixelDifference(widePixels, 105, 150) < pixelDifference(narrowPixels, 105, 150),
      'wider feather must soften the generated color near the mask boundary')
    assert.equal(pixelDifference(widePixels, 150, 150), pixelDifference(narrowPixels, 150, 150),
      'feather width must not change the mask interior')

    // Exercise API validation, shelf copies and temporary-task cleanup with raw saving enabled.
    const { studioProviderSettings } = await import('../src/server/common/studio-provider-settings')
    await studioProviderSettings.updateNovelAI({ apiKey: 'test-token' })
    const softRequest = {
      ...v5Request, focusedInpaint: true, inpaintContextPixels: 64,
      inpaintBlendMode: 'soft', inpaintFeatherPixels: 32, saveInpaintRaw: true,
    }
    const callApi = (body: unknown) => studioApi.request('/providers/novelai/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const responseWithRaw = await callApi(softRequest)
    assert.equal(responseWithRaw.status, 200)
    const withRaw = (await responseWithRaw.json()).data
    assert.equal(withRaw.items.length, 1, 'raw images are not counted as additional generated outputs')
    assert.equal(withRaw.rawItems.length, 1)
    const finalItem = withRaw.items[0]
    const rawItem = withRaw.rawItems[0]
    assert.equal(finalItem.provenance.novelai.request.inpaintBlendMode, 'soft')
    assert.equal(finalItem.provenance.novelai.request.inpaintFeatherPixels, 32)
    assert.equal(finalItem.provenance.novelai.request.saveInpaintRaw, true)
    assert.deepEqual(rawItem.provenance.novelai, finalItem.provenance.novelai)
    assert.equal(rawItem.provenance.inpaintRaw, true)
    assert.match(rawItem.name, /上游原始结果/)
    assert.equal(rawItem.provenance.sourceMetadata.Comment, nativeComment)
    assert.ok(rawItem.provenance.novelai.inpaintCrop.width > 0)
    const rawFile = await studioManager.file(rawItem.id)
    const rawPixels = await sharp(rawFile.buffer).ensureAlpha().raw().toBuffer()
    const expectedRaw = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#8a4fbd80' } }).png().toBuffer()
    assert.deepEqual(rawPixels, await sharp(expectedRaw).ensureAlpha().raw().toBuffer(), 'raw RGB and alpha must survive without local opacity repair, resizing or blending')
    assert.ok(!(await taskManager.getTasks()).some((task) => task.id === finalItem.provenance.sourceTaskId), 'temporary task must still be removed')
    assert.ok((await studioManager.file(finalItem.id)).buffer.length, 'both shelf copies survive temporary-task cleanup')
    assert.ok((await studioManager.file(rawItem.id)).buffer.length)
    assert.ok(!JSON.stringify(withRaw).includes('test-token'), 'saved diagnostics must not include credentials')

    const withoutRaw = await callApi({ ...softRequest, saveInpaintRaw: false })
    assert.equal(withoutRaw.status, 200)
    assert.deepEqual((await withoutRaw.json()).data.rawItems, [], 'raw saving remains opt-in')
    const beforeInvalid = requestBodies.length
    assert.equal((await callApi({ ...softRequest, inpaintBlendMode: 'unknown' })).status, 400)
    assert.equal(requestBodies.length, beforeInvalid, 'invalid blend modes must not reach the provider')

    const saveRaw = studioManager.fromInpaintRaw
    try {
      studioManager.fromInpaintRaw = async () => { throw new Error('simulated diagnostic write failure') }
      const failedRaw = await callApi(softRequest)
      assert.equal(failedRaw.status, 200)
      const partial = (await failedRaw.json()).data
      assert.equal(partial.items.length, 1)
      assert.equal(partial.rawItems.length, 0)
      assert.match(partial.warning, /上游原始结果保存失败/)
    } finally {
      studioManager.fromInpaintRaw = saveRaw
    }
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
