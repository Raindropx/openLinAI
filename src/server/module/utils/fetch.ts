/**
 * 带超时的 fetch 封装。
 *
 * 上游 API 卡死时，裸 fetch 会永久挂起，占用 TCP 连接和文件描述符。
 * 路由器上文件描述符有限，长期运行会因 FD 耗尽导致服务不可用。
 *
 * @param url 请求地址
 * @param options fetch 配置（原有 signal 会被合并）
 * @param timeoutMs 超时毫秒，默认 60s
 */
import { generationFetch } from '../../common/image-lifecycle'

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 60000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await generationFetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
