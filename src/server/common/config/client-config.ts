import type { Config, GptImageEndpoint } from './index'

/** The account credential is write-only in the settings API. */
export function clientConfig(config: Config) {
  return {
    ...config,
    endpoints: config.endpoints.map(({ balanceAccessToken, ...endpoint }) => ({
      ...endpoint,
      balanceAccessTokenConfigured: Boolean(balanceAccessToken),
    })),
  }
}

export function preserveBalanceCredentials(
  endpoints: GptImageEndpoint[],
  previous: GptImageEndpoint[],
): GptImageEndpoint[] {
  return endpoints.map(
    ({ balanceAccessTokenConfigured: _configured, ...endpoint }) => ({
      ...endpoint,
      balanceAccessToken:
        endpoint.balanceAccessToken === undefined
          ? previous.find((saved) => saved.id === endpoint.id)
              ?.balanceAccessToken
          : endpoint.balanceAccessToken.trim() || undefined,
    }),
  )
}
