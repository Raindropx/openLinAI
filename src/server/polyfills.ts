// openai SDK 上传文件（toFile）依赖全局 File 构造器。
// Node 20+ 已内置；Entware 等环境的旧版 Node 没有，需在 SDK 加载前补上。
// 必须在 server 入口最先 import，确保早于 ./api/gpt-image → openai 的加载。
import { Blob, File as NodeBufferFile } from 'node:buffer'

const g = globalThis as any

if (typeof g.File === 'undefined') {
  g.File =
    NodeBufferFile ||
    class File extends Blob {
      readonly name: string
      readonly lastModified: number
      constructor(
        parts: any[],
        name: string,
        options: { type?: string; lastModified?: number } = {},
      ) {
        super(parts, { type: options.type })
        this.name = name
        this.lastModified = options.lastModified ?? Date.now()
      }
    }
}
