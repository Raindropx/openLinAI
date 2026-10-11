import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Progress } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { ThumbnailCacheStatus } from '../../../../shared/thumbnail-cache'
import { refreshThumbnailCache } from '../../../hooks/useThumbnailCacheVersion'
import { t, useAppLanguage } from '../../../i18n'

const endpoint = '/api/static/images/thumbnail-cache'

export function ThumbnailCacheSetting() {
  useAppLanguage()
  const [status, setStatus] = useState<ThumbnailCacheStatus>()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let controller: AbortController | undefined
    const poll = async () => {
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 10000)
      try {
        const response = await fetch(endpoint, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('Status request failed')
        const result = await response.json()
        if (!result.success) throw new Error('Status request failed')
        if (stopped) return
        const next = result.data as ThumbnailCacheStatus
        setStatus(next)
        setError(false)
        if (next.id && next.state !== 'running') refreshThumbnailCache(next.id)
        if (next.state === 'running') timer = setTimeout(poll, 1000)
      } catch {
        if (!stopped) {
          setError(true)
          timer = setTimeout(poll, 5000)
        }
      } finally {
        clearTimeout(timeout)
      }
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
    }
  }, [refresh])

  const rebuild = async () => {
    if (starting || status?.state === 'running') return
    setStarting(true)
    try {
      const response = await fetch(`${endpoint}/rebuild`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error('Rebuild request failed')
      const result = await response.json()
      if (!result.success) throw new Error('Rebuild request failed')
      if (mounted.current) {
        setStatus(result.data)
        setError(false)
      }
    } catch {
      if (mounted.current) setError(true)
    } finally {
      if (mounted.current) {
        setStarting(false)
        // Also reconcile an ambiguous POST timeout: the server may have started.
        setRefresh((value) => value + 1)
      }
    }
  }
  const running = status?.state === 'running'
  return (
    <div className="space-y-3">
      <div>{t('缩略图缓存')}</div>
      <p className="text-sm text-slate-500">
        {t(
          '清理服务器上的缩略图缓存，并逐张重新生成。原图、任务记录和设置会保留；图片较多时需要一些时间，关闭设置后仍会继续。',
        )}
      </p>
      <Button
        className="h-auto! max-w-full whitespace-normal! py-1"
        icon={<ReloadOutlined />}
        loading={starting || running}
        disabled={!status || error}
        onClick={() => void rebuild()}
      >
        {t('清理缓存并重新生成缩略图')}
      </Button>
      {error && (
        <Alert
          type="warning"
          title={t('暂时无法获取缓存任务状态，正在重试。')}
        />
      )}
      {running && (
        <div aria-live="polite">
          <div className="text-sm">
            {status.phase === 'clearing'
              ? t('正在清理缩略图缓存…')
              : t('正在重新生成缩略图：{0}/{1}', [
                  status.processed,
                  status.total,
                ])}
          </div>
          <Progress
            percent={
              status.total
                ? Math.floor((status.processed / status.total) * 100)
                : 0
            }
            status="active"
          />
        </div>
      )}
      {status?.state === 'completed' && (
        <Alert
          type={status.failed ? 'warning' : 'success'}
          title={t(
            '缓存处理完成：清理 {0} 个文件，生成 {1} 张，失败 {2} 张，跳过 {3} 张。',
            [status.removed, status.regenerated, status.failed, status.skipped],
          )}
        />
      )}
      {status?.state === 'failed' && (
        <Alert type="error" title={t('缩略图缓存重建失败，请检查服务日志')} />
      )}
    </div>
  )
}
