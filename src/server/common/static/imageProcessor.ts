import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import fs from 'fs-extra'

const execFileAsync = promisify(execFile)

export const IMAGE_MAX_DIMENSION = 1600
export const IMAGE_COMPRESS_QUALITY = 60
export const THUMB_SIZE = 200
const THUMB_COMPRESS_QUALITY = 40

// ffmpeg 精简版通常不带 libwebp，但内置 mjpeg 编码器；走 JPEG 路线。
// mjpeg 的 -q:v 范围 1-31，越小质量越好（2≈无损，5 高，12 中等）。
const FFMPEG_JPEG_QUALITY_UPLOAD = 5
const FFMPEG_JPEG_QUALITY_THUMB = 12

type ImageBackend = 'sharp' | 'ffmpeg'

/**
 * 图像处理后端。默认使用 sharp（PC 开发，速度快、输出 webp、依赖原生模块）；
 * 在 OpenWrt 等 musl 环境下设置 IMAGE_BACKEND=ffmpeg 改用系统 ffmpeg
 * （输出 jpeg、无需原生模块、打包产物自包含）。
 */
function getBackend(): ImageBackend {
  return process.env.IMAGE_BACKEND === 'ffmpeg' ? 'ffmpeg' : 'sharp'
}

/**
 * ffmpeg 可执行文件路径。procd 等服务环境 PATH 通常不含 /opt/bin，
 * 因此允许通过 FFMPEG_BIN 指定绝对路径（如 /opt/bin/ffmpeg）。
 * PC 上默认 'ffmpeg'，靠 PATH 解析。
 */
function getFfmpegBin(): string {
  return process.env.FFMPEG_BIN || 'ffmpeg'
}

/** 当前后端产出的文件后缀，供 static 层命名/查表使用。 */
export function getImageOutputExtension(): string {
  return getBackend() === 'ffmpeg' ? '.jpg' : '.webp'
}

/** 当前后端产出的 MIME，供缩略图响应使用。 */
export function getImageOutputMimeType(): string {
  return getBackend() === 'ffmpeg' ? 'image/jpeg' : 'image/webp'
}

/**
 * 以 stdin 喂入 buffer、收集 stdout 的方式运行 ffmpeg。
 * （异步 execFile 不支持 input 选项，必须手动写 stdin。）
 */
function runFfmpegStdin(input: Buffer, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegBin(), args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    let stderr = ''
    let settled = false

    // 超时保护：损坏图片可能导致 ffmpeg 挂起
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      if (!settled) {
        settled = true
        reject(new Error('ffmpeg timed out after 30s'))
      }
    }, 30000)

    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(err)
      }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      if (code !== 0) {
        settled = true
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`))
      } else {
        settled = true
        resolve(Buffer.concat(chunks))
      }
    })
    child.stdin.on('error', (err) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(err)
      }
    })
    child.stdin.end(input)
  })
}

/**
 * 压缩上传的参考图：等比缩放到最长边不超过 IMAGE_MAX_DIMENSION（不放大）。
 * sharp 输出 webp；ffmpeg 输出 jpeg（精简版无 libwebp）。
 */
export async function compressUploadImage(buffer: Buffer): Promise<Buffer> {
  if (getBackend() === 'ffmpeg') {
    return compressUploadWithFfmpeg(buffer)
  }
  const sharp = (await import('sharp')).default
  return sharp(buffer)
    .resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_COMPRESS_QUALITY })
    .toBuffer()
}

async function compressUploadWithFfmpeg(buffer: Buffer): Promise<Buffer> {
  // force_original_aspect_ratio=decrease：等比缩放到框内且不放大
  return runFfmpegStdin(buffer, [
    '-i',
    'pipe:0',
    '-vf',
    `scale=${IMAGE_MAX_DIMENSION}:${IMAGE_MAX_DIMENSION}:force_original_aspect_ratio=decrease`,
    '-frames:v',
    '1',
    '-c:v',
    'mjpeg',
    '-q:v',
    String(FFMPEG_JPEG_QUALITY_UPLOAD),
    '-f',
    'image2pipe',
    'pipe:1',
  ])
}

/**
 * 生成缩略图文件：短边缩放到 THUMB_SIZE，写入 thumbPath。
 * 无法读取尺寸或编码失败时不写入文件，由调用方按文件是否存在判断。
 */
export async function generateThumbnailFile(
  sourcePath: string,
  thumbPath: string,
): Promise<void> {
  if (getBackend() === 'ffmpeg') {
    await generateThumbnailWithFfmpeg(sourcePath, thumbPath)
    return
  }
  const sharp = (await import('sharp')).default
  const metadata = await sharp(sourcePath).metadata()
  if (!metadata.width || !metadata.height) {
    return
  }
  const width = metadata.width > metadata.height ? undefined : THUMB_SIZE
  const height = metadata.width > metadata.height ? THUMB_SIZE : undefined
  const thumbBuffer = await sharp(sourcePath)
    .resize(width, height)
    .webp({ quality: THUMB_COMPRESS_QUALITY })
    .toBuffer()
  await fs.writeFile(thumbPath, thumbBuffer)
}

async function generateThumbnailWithFfmpeg(
  sourcePath: string,
  thumbPath: string,
): Promise<void> {
  // 短边缩放到 THUMB_SIZE：横图 (iw>ih) 时 h=THUMB_SIZE、w 自适应；竖图反之。
  // 单引号保护表达式内的逗号不被当作滤镜链分隔符。
  const filter = `scale='if(gt(iw,ih),-2,${THUMB_SIZE})':'if(gt(iw,ih),${THUMB_SIZE},-2)'`
  await execFileAsync(
    getFfmpegBin(),
    [
      '-y',
      '-i',
      sourcePath,
      '-vf',
      filter,
      '-frames:v',
      '1',
      '-c:v',
      'mjpeg',
      '-q:v',
      String(FFMPEG_JPEG_QUALITY_THUMB),
      thumbPath,
    ],
    { timeout: 30000 },
  )
}
