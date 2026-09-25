import { ReloadOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getStudioProviderBalance, type StudioProviderBalance } from './api'

export function ProviderBalance({
  provider,
  configured,
  keyHint,
}: {
  provider: 'novelai' | 'civitai'
  configured: boolean
  keyHint?: string
}) {
  const [balance, setBalance] = useState<StudioProviderBalance>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    if (!configured) return
    const id = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const next = await getStudioProviderBalance(provider)
      if (id === requestId.current) setBalance(next)
    } catch (failure) {
      if (id === requestId.current) {
        setBalance(undefined)
        setError(failure instanceof Error ? failure.message : '余额读取失败')
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [configured, provider])

  useEffect(() => {
    setBalance(undefined)
    setError('')
    if (configured) void refresh()
    return () => { requestId.current++ }
  }, [configured, keyHint, refresh])

  useEffect(() => {
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === provider) void refresh()
    }
    window.addEventListener('studio-balance-changed', onChanged)
    return () => window.removeEventListener('studio-balance-changed', onChanged)
  }, [provider, refresh])

  if (!configured) return null

  const content = provider === 'novelai'
    ? balance && 'anlas' in balance ? `Anlas ${balance.anlas.toLocaleString()}` : null
    : balance && 'yellow' in balance
      ? <><span className="studio-balance-yellow">黄 Buzz {balance.yellow.toLocaleString()}</span><span className="studio-balance-blue">蓝 Buzz {balance.blue.toLocaleString()}</span></>
      : null

  return (
    <div className="studio-provider-balance" aria-live="polite">
      <span className="studio-provider-balance-values">
        {content || (loading ? '余额读取中…' : '余额暂不可用')}
      </span>
      {error && <Tooltip title={error}><span className="studio-provider-balance-error">读取失败</span></Tooltip>}
      <Tooltip title="刷新余额">
        <Button type="text" size="small" icon={<ReloadOutlined />} loading={loading}
          aria-label="刷新余额" onClick={() => void refresh()} />
      </Tooltip>
    </div>
  )
}
