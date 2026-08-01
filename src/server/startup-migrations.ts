import fs from 'fs-extra'
import path from 'path'
import { getDataDir } from './common/data-dir'

const MIGRATION_VERSION = 'v1.2.0'
const LEGACY_TTS_CONFIG_KEY = 'ttsInworldApiKey'

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const writeJsonAtomicSync = (
  filePath: string,
  value: unknown,
  spaces?: number,
) => {
  fs.ensureDirSync(path.dirname(filePath))
  const tempPath = `${filePath}.${MIGRATION_VERSION}.tmp`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, spaces), 'utf-8')
    fs.renameSync(tempPath, filePath)
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.removeSync(tempPath)
    }
  }
}

const readJsonSync = (filePath: string): unknown =>
  JSON.parse(fs.readFileSync(filePath, 'utf-8'))

const getRecordKey = (value: unknown) => {
  if (isJsonObject(value) && typeof value.id === 'string') {
    return `id:${value.id}`
  }
  return `json:${JSON.stringify(value)}`
}

const quarantineLegacyRecords = (
  dataDir: string,
  fileName: string,
  backupName: string,
  isLegacyRecord: (value: unknown) => boolean,
) => {
  const filePath = path.join(dataDir, fileName)
  if (!fs.existsSync(filePath)) return

  const parsed = readJsonSync(filePath)
  if (!Array.isArray(parsed)) return

  const legacyRecords = parsed.filter(isLegacyRecord)
  if (legacyRecords.length === 0) return

  const backupPath = path.join(
    dataDir,
    '.migration-backups',
    MIGRATION_VERSION,
    backupName,
  )
  const existingBackup = fs.existsSync(backupPath)
    ? readJsonSync(backupPath)
    : []
  if (!Array.isArray(existingBackup)) {
    throw new Error(`迁移备份文件格式错误: ${backupPath}`)
  }

  const mergedBackup = [...existingBackup]
  const backupKeys = new Set(existingBackup.map(getRecordKey))
  for (const record of legacyRecords) {
    const key = getRecordKey(record)
    if (!backupKeys.has(key)) {
      backupKeys.add(key)
      mergedBackup.push(record)
    }
  }

  writeJsonAtomicSync(backupPath, mergedBackup, 2)
  writeJsonAtomicSync(
    filePath,
    parsed.filter((record) => !isLegacyRecord(record)),
  )
  console.log(
    `[迁移 ${MIGRATION_VERSION}] 已隔离 ${legacyRecords.length} 条旧 ${fileName} 记录`,
  )
}

const migrateLegacyTtsConfig = (dataDir: string) => {
  const configPath = path.join(dataDir, 'config.json')
  if (!fs.existsSync(configPath)) return

  const parsed = readJsonSync(configPath)
  if (
    !isJsonObject(parsed) ||
    !Object.prototype.hasOwnProperty.call(parsed, LEGACY_TTS_CONFIG_KEY)
  ) {
    return
  }

  delete parsed[LEGACY_TTS_CONFIG_KEY]
  writeJsonAtomicSync(configPath, parsed, 2)
  console.log(`[迁移 ${MIGRATION_VERSION}] 已移除旧 TTS 配置字段`)
}

const isLegacyVideoTemplate = (value: unknown) =>
  isJsonObject(value) && value.usageType === 'video'

const isLegacyVideoTask = (value: unknown) =>
  isJsonObject(value) &&
  isJsonObject(value.rawTemplate) &&
  value.rawTemplate.usageType === 'video'

const runStartupMigrations = () => {
  const dataDir = getDataDir()
  migrateLegacyTtsConfig(dataDir)
  quarantineLegacyRecords(
    dataDir,
    'templates.json',
    'video-templates.json',
    isLegacyVideoTemplate,
  )
  quarantineLegacyRecords(
    dataDir,
    'tasks.json',
    'video-tasks.json',
    isLegacyVideoTask,
  )
}

try {
  runStartupMigrations()
} catch (error) {
  console.error(`[迁移 ${MIGRATION_VERSION}] 失败，已停止启动以保护数据:`, error)
  throw error
}
