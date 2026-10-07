import { useMemo } from 'react'
import type { LlmEndpoint } from '../../server/common/config'
import { useGlobalStore } from '../store/global'

export function resolveLlmEndpointId(
  endpoints: LlmEndpoint[],
  ...preferredIds: (string | undefined)[]
): string | undefined {
  const enabled = endpoints.filter((endpoint) => !endpoint.disabled)
  return (
    preferredIds.find((id) => enabled.some((endpoint) => endpoint.id === id)) ||
    enabled[0]?.id
  )
}

export function useEnabledLlmEndpoints() {
  const endpoints = useGlobalStore((state) => state.llmEndpoints)
  return useMemo(
    () => endpoints.filter((endpoint) => !endpoint.disabled),
    [endpoints],
  )
}
