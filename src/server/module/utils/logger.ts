import { EventEmitter } from 'events'
import fs from 'fs-extra'
import path from 'path'
import { getDataDir } from '../../common/data-dir'

const LOG_DIR = path.join(getDataDir(), 'logs')

/** 单个日志文件最大字节数，超过后轮转 */
const MAX_LOG_SIZE = 2 * 1024 * 1024 // 2MB
/** 保留的轮转文件数量（app.log.1, app.log.2, ...） */
const MAX_ROTATED_FILES = 2

export class Logger extends EventEmitter {
  private id: string
  private logFile: string

  constructor(id: string) {
    super()
    this.id = id
    fs.ensureDirSync(LOG_DIR)
    this.logFile = path.join(LOG_DIR, `${id}.log`)
  }

  private formatMessage(message: any, ...args: any[]): string {
    const timestamp = new Date().toLocaleString()
    let formattedMessage =
      typeof message === 'string' ? message : JSON.stringify(message, null, 2)

    if (args.length > 0) {
      args.forEach((arg) => {
        const argStr =
          typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)
        formattedMessage += ' ' + argStr
      })
    }

    return `[${timestamp}] [${this.id}] ${formattedMessage}`
  }

  /**
   * 检查日志文件大小，超过阈值时轮转：
   * app.log → app.log.1 → app.log.2（删除最老的）
   */
  private async rotateIfNeeded() {
    try {
      const stat = await fs.stat(this.logFile)
      if (stat.size < MAX_LOG_SIZE) return

      // 删除最老的轮转文件
      const oldest = `${this.logFile}.${MAX_ROTATED_FILES}`
      if (await fs.pathExists(oldest)) {
        await fs.remove(oldest)
      }

      // 依次重命名 app.log.N → app.log.N+1
      for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
        const from = `${this.logFile}.${i}`
        const to = `${this.logFile}.${i + 1}`
        if (await fs.pathExists(from)) {
          await fs.rename(from, to)
        }
      }

      // 当前日志 → app.log.1
      await fs.rename(this.logFile, `${this.logFile}.1`)
    } catch {
      // 轮转失败不影响日志写入
    }
  }

  private writeToFile(message: string) {
    // 异步写入，不阻塞事件循环；轮转检查也异步进行
    this.rotateIfNeeded()
      .then(() => fs.appendFile(this.logFile, message + '\n'))
      .then(() => this.emit('log', message))
      .catch((error) => console.error('无法写入日志文件:', error))
  }

  log(message: any, ...args: any[]) {
    console.log(message, ...args)
    const fullMessage = this.formatMessage(message, ...args)
    this.writeToFile(fullMessage)
  }

  error(message: any, ...args: any[]) {
    console.error(message, ...args)
    const fullMessage = this.formatMessage(message, ...args)
    this.writeToFile(fullMessage)
  }

  info(message: any, ...args: any[]) {
    this.log(message, ...args)
  }

  warn(message: any, ...args: any[]) {
    console.warn(message, ...args)
    const fullMessage = this.formatMessage(`⚠️ ${message}`, ...args)
    this.writeToFile(fullMessage)
  }

  /**
   * 读取最近的日志行。先读当前文件，不足时从轮转文件补充。
   */
  getLogs(limit: number = 100): string[] {
    try {
      const lines: string[] = []

      // 从轮转文件补充（从新到旧）
      for (let i = 1; i <= MAX_ROTATED_FILES && lines.length < limit; i++) {
        const rotated = `${this.logFile}.${i}`
        if (!fs.existsSync(rotated)) continue
        const content = fs.readFileSync(rotated, 'utf-8')
        const rotatedLines = content.trim().split('\n').filter(Boolean)
        lines.unshift(...rotatedLines)
        if (lines.length > limit) {
          lines.splice(0, lines.length - limit)
        }
      }

      // 读当前日志文件
      if (fs.existsSync(this.logFile)) {
        const content = fs.readFileSync(this.logFile, 'utf-8')
        const currentLines = content.trim().split('\n').filter(Boolean)
        lines.push(...currentLines)
      }

      return lines.slice(-limit)
    } catch (error) {
      console.error('无法读取日志文件:', error)
      return []
    }
  }

  clearLogs() {
    try {
      if (fs.existsSync(this.logFile)) {
        fs.writeFileSync(this.logFile, '')
      }
      // 同时清理轮转文件
      for (let i = 1; i <= MAX_ROTATED_FILES; i++) {
        const rotated = `${this.logFile}.${i}`
        if (fs.existsSync(rotated)) {
          fs.writeFileSync(rotated, '')
        }
      }
      this.emit('clear')
    } catch (error) {
      console.error('无法清除日志文件:', error)
    }
  }
}

// Default logger for backward compatibility if needed, or update references
export const logger = new Logger('app')
