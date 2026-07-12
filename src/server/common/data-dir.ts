import path from 'path'

/**
 * 返回数据根目录。
 *
 * 默认指向 <cwd>/data；在 OpenWrt 等嵌入式环境上通过 DATA_DIR 环境变量
 * 重定向到外接存储（如 /mnt/sda1/linai/data），避免写入 Flash。
 */
export function getDataDir(): string {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(process.cwd(), 'data')
}
