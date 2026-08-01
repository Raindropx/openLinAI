import { ApiOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { useMemo } from 'react'
import { useGPTImageQuota } from '../../../hooks/useGPTImageQuota'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../store/global'
import { openSettingModal } from '../SettingModal'

export function GPTImageQuota() {
  const endpoints = useGlobalStore((state) => state.endpoints)
  const { gptImageSettings } = useLocalSetting()
  const selectedEndpoint = useMemo(
    () =>
      endpoints.find((e) => e.id === gptImageSettings.selectedEndpointId) ||
      endpoints[0],
    [endpoints, gptImageSettings.selectedEndpointId],
  )
  const { quota, loading, error } = useGPTImageQuota()

  if (!selectedEndpoint) return null

  const supportsQuota =
    selectedEndpoint.type === 'yunwu' ||
    selectedEndpoint.type === 'openrouter' ||
    (selectedEndpoint.type === 'custom' && selectedEndpoint.balanceEnabled)
  const isOpenRouter = selectedEndpoint.type === 'openrouter'
  const endpointName =
    selectedEndpoint.name || selectedEndpoint.model || '未命名端点'

  return (
    <Tooltip
      title={supportsQuota && error ? error : '点击打开图片端点设置'}
      placement="bottom"
    >
      <div
        className="flex max-w-[min(52vw,30rem)] cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100"
        onClick={() => openSettingModal({ initialTab: 'gpt-image' })}
      >
        <ApiOutlined className="shrink-0 text-xs" />
        <span className="truncate font-medium text-slate-700">
          {endpointName}
        </span>
        {supportsQuota && (loading || error || quota) && (
          <>
            <span className="mx-1 h-3.5 w-px shrink-0 bg-slate-300" />
            {loading ? (
              <span className="shrink-0 text-slate-400">余额查询中...</span>
            ) : error ? (
              <span className="line-clamp-1 max-w-40 shrink-0 text-red-500">
                余额: {error}
              </span>
            ) : quota ? (
              <span className="shrink-0">
                余额：
                <span className="font-semibold text-slate-800">
                  {quota.unlimited_quota
                    ? '不限'
                    : isOpenRouter
                      ? `$${quota.total_available.toFixed(2)}`
                      : selectedEndpoint.type === 'yunwu'
                        ? `${(quota.total_available * 0.000001).toFixed(2)}￥`
                        : quota.total_available.toFixed(2)}
                </span>
              </span>
            ) : null}
          </>
        )}
      </div>
    </Tooltip>
  )
}
