import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-image-serving-'))
  process.env.DATA_DIR = root
  const ffmpeg = process.argv.includes('--ffmpeg')
  process.env.IMAGE_BACKEND = ffmpeg ? 'ffmpeg' : 'sharp'
  const originalExec = childProcess.execFile
  let encodes = 0
  childProcess.execFile = ((...args: any[]) => {
    encodes++
    return (originalExec as any)(...args)
  }) as typeof originalExec
  const originalToWeb = Readable.toWeb
  const streams: Readable[] = []
  Readable.toWeb = ((stream: Readable, options: any) => {
    streams.push(stream)
    return originalToWeb(stream, options)
  }) as typeof originalToWeb
  try {
    const { default: api } = await import('../src/server/api/common/static')
    const { serveImage } = await import('../src/server/common/static')
    const { imageThumbnailUrl, localImageVariant } =
      await import('../src/client/utils/imageUrls')
    const image = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer()
    const generated = path.join(root, 'images', 'generated')
    await fs.writeFile(path.join(generated, 'fixture.png'), image)
    const url = '/images/generated/fixture.png'
    const info = await (await api.request(`${url}?metadata=true`)).json()
    assert.deepEqual(info, { bytes: image.length, width: 640, height: 480 })
    const beforeHead = streams.length
    const head = await api.request(url, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('Content-Length'), String(image.length))
    assert.equal((await head.arrayBuffer()).byteLength, 0)
    assert.equal(
      streams.length,
      beforeHead,
      'HEAD must not start reading a file',
    )
    const response = await api.request(url)
    assert.equal(response.headers.get('Content-Type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image)

    const thumbnails = await Promise.all(
      Array.from({ length: 12 }, async () => {
        const response = await api.request(`${url}?thumb=true`)
        assert.equal(response.status, 200)
        return Buffer.from(await response.arrayBuffer())
      }),
    )
    for (const thumbnail of thumbnails)
      assert.deepEqual(thumbnail, thumbnails[0])
    const dimensions = await sharp(thumbnails[0]).metadata()
    assert.equal(dimensions.height, 200)
    assert.ok(thumbnails[0].length < image.length)
    if (ffmpeg)
      assert.equal(encodes, 1, 'simultaneous cache misses share one FFmpeg job')
    await (await api.request(`${url}?thumb=true`)).arrayBuffer()
    if (ffmpeg) assert.equal(encodes, 1, 'warm cache does not encode again')

    // Large WebP bitstream: dimensions must be readable from a partial header.
    const webpHeader = Buffer.alloc(30)
    webpHeader.write('RIFF', 0)
    webpHeader.write('WEBPVP8 ', 8)
    webpHeader.writeUInt32LE(1_000_000, 16)
    webpHeader.writeUInt16LE(640, 26)
    webpHeader.writeUInt16LE(480, 28)
    await fs.writeFile(path.join(generated, 'header.webp'), webpHeader)
    assert.deepEqual(
      await (
        await api.request('/images/generated/header.webp?metadata=true')
      ).json(),
      { bytes: 30, width: 640, height: 480 },
    )
    for (const format of ['jpeg', 'webp', 'gif'] as const) {
      const buffer = await sharp(image).toFormat(format).toBuffer()
      await fs.writeFile(path.join(generated, `fixture.${format}`), buffer)
      assert.deepEqual(
        await (
          await api.request(`/images/generated/fixture.${format}?metadata=true`)
        ).json(),
        { bytes: buffer.length, width: 640, height: 480 },
      )
    }

    await fs.writeFile(path.join(generated, 'broken.png'), 'invalid-image')
    const failedBefore = encodes
    const fallbacks = await Promise.all(
      Array.from({ length: 8 }, async () =>
        (await api.request('/images/generated/broken.png?thumb=true')).text(),
      ),
    )
    assert.ok(fallbacks.every((body) => body === 'invalid-image'))
    if (ffmpeg)
      assert.equal(encodes, failedBefore + 1, 'failed job is also shared')
    await (await api.request('/images/generated/broken.png?thumb=true')).text()
    if (ffmpeg)
      assert.equal(encodes, failedBefore + 2, 'failed job can retry later')
    const thumbnailFiles = await fs.readdir(
      path.join(root, 'images', 'thumb', 'generated'),
    )
    assert.equal(
      thumbnailFiles.length,
      1,
      'failed and temporary thumbnails are removed',
    )

    const largePath = path.join(generated, 'large.png')
    const large = await fs.open(largePath, 'w')
    await large.truncate(32 * 1024 * 1024)
    await large.close()
    const slow = await serveImage({ type: 'generated', filename: 'large.png' })
    const source = streams.at(-1)! as Readable & { bytesRead: number }
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(
      source.bytesRead <= 256 * 1024,
      `slow client buffered ${source.bytesRead} bytes`,
    )
    await slow!.body!.cancel()
    if (!source.closed)
      await new Promise<void>((resolve) => source.once('close', resolve))
    assert.ok(source.destroyed, 'cancel closes the file stream')
    await fs.unlink(largePath)
    assert.equal(
      (await api.request('/images/generated/missing.png')).status,
      404,
    )
    assert.equal(
      await serveImage({ type: 'generated', filename: '../tasks.json' }),
      null,
    )
    assert.equal(
      imageThumbnailUrl('/api/static/images/generated/a.png?v=1#x'),
      '/api/static/images/generated/a.png?v=1&thumb=true#x',
    )
    assert.equal(
      localImageVariant('https://example.com/a.png', 'metadata'),
      undefined,
    )
    assert.equal(
      imageThumbnailUrl('data:image/png;base64,a'),
      'data:image/png;base64,a',
    )
    console.log(
      `${ffmpeg ? 'FFmpeg' : 'Sharp'}: original integrity, HEAD, metadata, thumbnail concurrency/cache/failure/retry, bounded streaming and cancellation passed`,
    )
  } finally {
    Readable.toWeb = originalToWeb
    childProcess.execFile = originalExec
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('linai-image-serving-'))
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
