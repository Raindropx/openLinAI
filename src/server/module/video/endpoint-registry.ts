import { videoEndpointSettings } from '../../common/video-endpoint-settings'
import { ConfiguredVideoProvider } from './configured-provider'
import { videoProviders } from './providers'

const configured = new Set<string>()
let signature = ''
export async function syncVideoEndpoints() {
  const endpoints = await videoEndpointSettings.read()
  const next = JSON.stringify(endpoints)
  if (next === signature) return
  for (const id of configured) videoProviders.delete(id)
  configured.clear()
  for (const endpoint of endpoints) {
    if (!endpoint.apiKey) continue
    const provider = new ConfiguredVideoProvider(endpoint)
    videoProviders.set(endpoint.id, provider)
    configured.add(endpoint.id)
  }
  signature = next
}
