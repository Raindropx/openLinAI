import { useEffect, useState } from 'react'

export type EndpointModelCatalog =
  | 'openai'
  | 'openai-image'
  | 'openai-vision-text'
  | 'openrouter-images'
  | 'venice-text'
  | 'venice-vision-text'
  | 'venice-image'
  | 'venice-inpaint'

export interface EndpointModelOption {
  id: string
  name: string
  type?: string
  privacy?: string
  constraints?: unknown
}

export function useEndpointModels(options: {
  catalog: EndpointModelCatalog
  baseURL?: string
  apiKey?: string
  enabled?: boolean
}) {
  const { catalog, enabled = true } = options
  const baseURL = options.baseURL?.trim() || ''
  const apiKey = options.apiKey?.trim() || ''
  const [models, setModels] = useState<EndpointModelOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (!enabled || !baseURL || !apiKey) {
      setModels([])
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setModels([])
      setLoading(true)
      setError(null)
      fetch('/api/model-catalog/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalog, baseURL, apiKey }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}))
          if (!response.ok || !data.success) {
            if (response.status === 404 || response.status === 405) {
              throw new Error('当前后端未加载通用模型目录路由，请重启后端')
            }
            throw new Error(
              data.error || `模型目录请求失败 (${response.status})`,
            )
          }
          setModels(Array.isArray(data.data) ? data.data : [])
        })
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') {
            return
          }
          setError(reason instanceof Error ? reason.message : String(reason))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 400)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [apiKey, baseURL, catalog, enabled, refreshToken])

  return {
    models,
    loading,
    error,
    refresh: () => setRefreshToken((token) => token + 1),
  }
}
