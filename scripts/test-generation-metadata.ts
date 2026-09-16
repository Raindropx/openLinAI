import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  embedGenerationMetadata,
  type GenerationMetadataInput,
} from '../src/server/module/gpt-image/generation-metadata'

function readPngText(buffer: Buffer) {
  const texts = new Map<string, string>()
  for (let offset = 8; offset + 12 <= buffer.length; ) {
    const size = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + size)
    if (type === 'tEXt' || type === 'iTXt') {
      const separator = data.indexOf(0)
      const key = data.toString('latin1', 0, separator)
      assert.ok(!texts.has(key), `Duplicate PNG keyword ${key}`)
      if (type === 'tEXt')
        texts.set(key, data.toString('latin1', separator + 1))
      else {
        assert.equal(data[separator + 1], 0, 'Uncompressed iTXt')
        const languageEnd = data.indexOf(0, separator + 3)
        const translationEnd = data.indexOf(0, languageEnd + 1)
        texts.set(key, data.toString('utf8', translationEnd + 1))
      }
    }
    offset += size + 12
  }
  return Object.fromEntries(texts)
}

function readExifComment(exif: Buffer) {
  const tiff =
    exif.toString('ascii', 0, 6) === 'Exif\0\0' ? exif.subarray(6) : exif
  const le = tiff.toString('ascii', 0, 2) === 'II'
  const read16 = (offset: number) =>
    le ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset)
  const read32 = (offset: number) =>
    le ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset)
  const findEntry = (ifd: number, tag: number) => {
    const count = read16(ifd)
    for (let index = 0; index < count; index += 1) {
      const offset = ifd + 2 + index * 12
      if (read16(offset) === tag) return offset
    }
    throw new Error(`Missing EXIF tag ${tag.toString(16)}`)
  }
  const exifPointer = findEntry(read32(4), 0x8769)
  const comment = findEntry(read32(exifPointer + 8), 0x9286)
  const bytes = tiff.subarray(
    read32(comment + 8),
    read32(comment + 8) + read32(comment + 4),
  )
  assert.equal(bytes.toString('ascii', 0, 8), 'UNICODE\0')
  return JSON.parse(new TextDecoder('utf-16be').decode(bytes.subarray(8)))
}

async function inspect(buffer: Buffer, format: string) {
  return format === 'png'
    ? readPngText(buffer)
    : readExifComment((await sharp(buffer).metadata()).exif!)
}

async function main() {
  const input: GenerationMetadataInput = {
    title: '流云 🦁',
    prompt: '石狮，金色流云\nA calm guardian ☁️',
    originalPrompt: '原始提示词',
    model: 'test/model-id',
    engine: 'images',
    requestedSize: '1k',
    aspectRatio: '4:3',
    quality: 'high',
    referenceImageCount: 0,
  }
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const source = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: '#254878',
      },
    })
      [format]()
      .toBuffer()
    for (const prompt of [
      input.prompt,
      'ASCII prompt',
      '\u0000🦁\\"\n'.repeat(20_000),
    ]) {
      const output = await embedGenerationMetadata(source, format, {
        ...input,
        prompt,
      })
      const metadata = await inspect(output, format)
      const comment = JSON.parse(metadata.Comment)
      assert.equal(metadata.Title, input.title)
      assert.equal(metadata.Software, 'openLinAI')
      assert.equal(metadata.Source, input.model)
      assert.equal(comment.width, 32)
      assert.equal(comment.height, 24)
      assert.equal(comment.originalPrompt, input.originalPrompt)
      assert.equal(comment.seed, undefined)
      assert.equal(comment.steps, undefined)
      assert.equal(comment.signed_hash, undefined)
      if (prompt.length < 1000 || format === 'png')
        assert.equal(comment.prompt, prompt)
      else assert.ok(comment.prompt.endsWith('…'))
      assert.deepEqual(
        await sharp(output).raw().toBuffer(),
        await sharp(source).raw().toBuffer(),
      )
      if (format === 'png')
        assert.ok(metadata.parameters.startsWith(prompt + '\nSteps:'))
    }
    const first = await embedGenerationMetadata(source, format, input)
    const rewritten = await embedGenerationMetadata(first, format, {
      ...input,
      title: '',
      prompt: 'New prompt',
      originalPrompt: undefined,
    })
    const metadata = await inspect(rewritten, format)
    assert.equal(metadata.Title, 'Trial Template')
    assert.equal(JSON.parse(metadata.Comment).prompt, 'New prompt')
    assert.equal(JSON.parse(metadata.Comment).originalPrompt, undefined)

    if (format !== 'png') {
      const withSourceExif = await sharp(source)
        .withMetadata({ orientation: 6 })
        .withExifMerge({
          IFD0: { Artist: 'Original artist' },
          IFD2: { UserComment: 'Old parameters' },
        })
        .toBuffer()
      const merged = await embedGenerationMetadata(
        withSourceExif,
        format,
        input,
      )
      assert.equal((await sharp(merged).metadata()).orientation, 6)
      assert.ok(
        (await sharp(merged).metadata()).exif!.includes(
          Buffer.from('Original artist'),
        ),
      )
      assert.equal(
        JSON.parse((await inspect(merged, format)).Comment).prompt,
        input.prompt,
      )
      assert.deepEqual(
        await sharp(merged).raw().toBuffer(),
        await sharp(withSourceExif).raw().toBuffer(),
      )
    }
    if (format === 'jpeg') {
      for (const littleEndian of [true, false]) {
        // A minimal source TIFF with only Orientation, no Exif sub-IFD.
        const tiff = Buffer.alloc(26)
        const write16 = (value: number, offset: number) =>
          littleEndian
            ? tiff.writeUInt16LE(value, offset)
            : tiff.writeUInt16BE(value, offset)
        const write32 = (value: number, offset: number) =>
          littleEndian
            ? tiff.writeUInt32LE(value, offset)
            : tiff.writeUInt32BE(value, offset)
        tiff.write(littleEndian ? 'II' : 'MM')
        write16(42, 2)
        write32(8, 4)
        write16(1, 8)
        write16(0x0112, 10)
        write16(3, 12)
        write32(1, 14)
        write16(6, 18)
        const segment = Buffer.alloc(10 + tiff.length)
        segment[0] = 0xff
        segment[1] = 0xe1
        segment.writeUInt16BE(segment.length - 2, 2)
        segment.write('Exif\0\0', 4)
        tiff.copy(segment, 10)
        const withSourceExif = Buffer.concat([
          source.subarray(0, 2),
          segment,
          source.subarray(2),
        ])
        const merged = await embedGenerationMetadata(
          withSourceExif,
          format,
          input,
        )
        assert.equal((await sharp(merged).metadata()).orientation, 6)
        assert.equal(
          JSON.parse((await inspect(merged, format)).Comment).prompt,
          input.prompt,
        )
      }
    }
    console.log(
      `PASS ${format}: fields, Unicode, long JSON, original prompt, unchanged pixels, rewrite and source EXIF`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
