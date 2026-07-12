import fs from 'fs-extra'
import path from 'path'

/**
 * 安全的 JSON 文件存储，解决三个核心问题：
 *
 * 1. 并发写入竞态 —— 内部 Promise 队列串行化所有写操作，
 *    read-modify-write 期间不会被其他写操作插入。
 * 2. 写入中途崩溃 —— 采用「写临时文件 + rename」原子写入，
 *    进程被 kill / 断电时不会留下截断的残缺 JSON。
 * 3. 文件损坏后误覆盖 —— read 解析失败时自动备份损坏文件
 *    并返回 null，调用方可决定是否重置，避免用空数组静默覆盖。
 */
export class SafeJsonStore<T> {
  private filePath: string
  private corruptBackupDir: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string, corruptBackupDir?: string) {
    this.filePath = filePath
    this.corruptBackupDir =
      corruptBackupDir || path.join(path.dirname(filePath), '.corrupt-backups')
  }

  /**
   * 读取数据。
   * - 文件不存在 → 返回 null
   * - 文件存在但解析失败 → 备份损坏文件后返回 null
   */
  async read(): Promise<T | null> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8')
      return JSON.parse(data) as T
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null
      }
      // 文件存在但解析失败 → 备份损坏文件
      await this.backupCorruptFile()
      return null
    }
  }

  /**
   * 原子写入：先写 .tmp 临时文件，再 rename 覆盖目标文件。
   * 通过内部 Promise 队列串行化，避免并发写入竞态。
   */
  async write(data: T): Promise<void> {
    let thrownError: unknown
    this.writeQueue = this.writeQueue
      .then(async () => {
        const tmp = this.filePath + '.tmp'
        await fs.writeFile(tmp, JSON.stringify(data), 'utf-8')
        await fs.rename(tmp, this.filePath)
      })
      .catch((e) => {
        // 捕获错误以保持队列健康，但记录下来重新抛给调用方
        thrownError = e
      })
    await this.writeQueue
    if (thrownError) throw thrownError
  }

  /**
   * 读取 → 修改 → 写回，整个操作串行化。
   * 若文件不存在或损坏，以空数组作为默认值（适用于数组类存储）。
   * 返回修改后的数据，避免调用方重复读取。
   */
  async mutate(mutator: (data: T) => T): Promise<T> {
    let result: T
    let thrownError: unknown
    this.writeQueue = this.writeQueue
      .then(async () => {
        const raw = await this.read()
        const current: T = raw === null ? ([] as unknown as T) : raw
        result = mutator(current)
        const tmp = this.filePath + '.tmp'
        await fs.writeFile(tmp, JSON.stringify(result), 'utf-8')
        await fs.rename(tmp, this.filePath)
      })
      .catch((e) => {
        thrownError = e
      })
    await this.writeQueue
    if (thrownError) throw thrownError
    return result!
  }

  /**
   * 同步备份损坏文件（供同步初始化逻辑使用）。
   */
  backupCorruptFileSync(): void {
    try {
      if (!fs.existsSync(this.filePath)) return
      fs.ensureDirSync(this.corruptBackupDir)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupName = `${path.basename(this.filePath)}.${timestamp}.corrupt`
      fs.copyFileSync(
        this.filePath,
        path.join(this.corruptBackupDir, backupName),
      )
    } catch {
      // 备份失败不影响主流程
    }
  }

  private async backupCorruptFile(): Promise<void> {
    try {
      if (!(await fs.pathExists(this.filePath))) return
      await fs.ensureDir(this.corruptBackupDir)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupName = `${path.basename(this.filePath)}.${timestamp}.corrupt`
      await fs.copy(
        this.filePath,
        path.join(this.corruptBackupDir, backupName),
      )
    } catch {
      // 备份失败不影响主流程
    }
  }
}
