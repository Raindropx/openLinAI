import { useMemo } from 'react'
import type { GptImageEndpoint } from '../../server/common/config'
import { useGlobalStore } from '../store/global'

export function resolveImageEndpointId(
  endpoints: GptImageEndpoint[],
  ...preferredIds: (string | undefined)[]
): string | undefined {
  const enabled = endpoints.filter((endpoint) => !endpoint.disabled)
  return (
    preferredIds.find((id) => enabled.some((endpoint) => endpoint.id === id)) ||
    enabled[0]?.id
  )
}

export function useEnabledImageEndpoints() {
  const endpoints = useGlobalStore((state) => state.endpoints)
  return useMemo(
    () => endpoints.filter((endpoint) => !endpoint.disabled),
    [endpoints],
  )
}
