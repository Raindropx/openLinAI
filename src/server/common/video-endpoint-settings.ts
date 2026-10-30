import fs from 'fs-extra'
import path from 'node:path'
import {
  videoEndpointSchema,
  type VideoEndpoint,
} from '../../shared/video-endpoints'
import { getDataDir } from './data-dir'
import { SafeJsonStore } from './safe-json-store'

export type StoredVideoEndpoint = Omit<
  VideoEndpoint,
  'apiKeyConfigured' | 'keyHint'
> & { apiKey: string }
export class VideoEndpointSettings {
  private store: SafeJsonStore<StoredVideoEndpoint[]>
  private filePath: string
  constructor(root = getDataDir()) {
    this.filePath = path.join(root, 'video-endpoints.json')
    this.store = new SafeJsonStore(this.filePath)
  }
  async read() {
    return (await this.store.read()) || []
  }
  async publicSettings() {
    return (await this.read()).map(({ apiKey, ...endpoint }) => ({
      ...endpoint,
      apiKeyConfigured: Boolean(apiKey),
      keyHint: apiKey
        ? apiKey.length <= 4
          ? '••••'
          : '••••' + apiKey.slice(-4)
        : undefined,
    }))
  }
  async save(raw: unknown, inUse: Set<string> = new Set()) {
    const input = videoEndpointSchema.parse(raw)
    await fs.ensureDir(path.dirname(this.filePath))
    await this.store.mutate((saved) => {
      const previous = saved.find((endpoint) => endpoint.id === input.id)
      const changedDestination =
        previous &&
        (previous.baseURL.replace(/\/+$/, '') !==
          input.baseURL.replace(/\/+$/, '') ||
          previous.protocol !== input.protocol ||
          previous.network !== input.network)
      if (
        previous &&
        inUse.has(input.id) &&
        (changedDestination ||
          previous.model !== input.model ||
          JSON.stringify(previous.options) !== JSON.stringify(input.options) ||
          JSON.stringify(previous.comfyUI) !== JSON.stringify(input.comfyUI))
      )
        throw new Error(
          '端点仍有关联视频任务。请复制为新端点，或仅修改名称、密钥和启用状态',
        )
      if (changedDestination && !input.apiKey && input.network !== 'local')
        throw new Error('修改 API 地址或协议后需要重新填写 API Key')
      const apiKey =
        input.apiKey || (!changedDestination ? previous?.apiKey : '') || ''
      if (input.enabled && !apiKey && input.network !== 'local')
        throw new Error('启用视频端点前请填写 API Key')
      const next: StoredVideoEndpoint = {
        ...input,
        baseURL: input.baseURL.replace(/\/+$/, ''),
        apiKey,
      }
      return previous
        ? saved.map((endpoint) => (endpoint.id === next.id ? next : endpoint))
        : [...saved, next]
    })
    return this.publicSettings()
  }
  async remove(id: string, inUse = new Set<string>()) {
    if (inUse.has(id))
      throw new Error('端点仍有关联视频任务，请先停用端点或删除相关任务')
    await fs.ensureDir(path.dirname(this.filePath))
    await this.store.mutate((saved) =>
      saved.filter((endpoint) => endpoint.id !== id),
    )
    return this.publicSettings()
  }
  async mediaHosts() {
    return [
      ...new Set(
        (await this.read()).flatMap((endpoint) => [
          new URL(endpoint.baseURL).hostname,
          ...endpoint.mediaHosts,
        ]),
      ),
    ]
  }
}
export const videoEndpointSettings = new VideoEndpointSettings()
