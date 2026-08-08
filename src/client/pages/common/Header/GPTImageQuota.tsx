import { ApiOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { useMemo } from 'react'
import { useGPTImageQuota } from '../../../hooks/useGPTImageQuota'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../store/global'
import { openSettingModal } from '../SettingModal'

export function GPTImageQuota({
  variant = 'header',
}: {
  variant?: 'header' | 'sidebar' | 'pull'
}) {
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
  const sidebar = variant === 'sidebar'
  const pull = variant === 'pull'

  return (
    <Tooltip
      title={supportsQuota && error ? error : '点击打开图片端点设置'}
      placement="bottom"
    >
      <div
        className={`cursor-pointer rounded-md border border-[#343a44] bg-[#20242b] text-sm text-slate-400 transition-colors hover:border-[#4a5361] hover:bg-[#292e37] ${
          sidebar
            ? 'flex w-full flex-col items-stretch gap-1 px-3 py-2'
            : pull
              ? 'flex w-full items-center justify-center gap-1.5 px-3 py-1.5'
              : 'flex max-w-[min(52vw,30rem)] items-center gap-1.5 px-3 py-1.5'
        }`}
        onClick={() => openSettingModal({ initialTab: 'gpt-image' })}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ApiOutlined className="shrink-0 text-xs" />
          <span className="truncate font-medium text-slate-200">
            {endpointName}
          </span>
        </span>
        {supportsQuota && (loading || error || quota) && (
          <span
            className={
              sidebar
                ? 'min-w-0 truncate pl-4 text-xs'
                : 'flex min-w-0 items-center gap-1'
            }
          >
            {!sidebar && (
              <span className="mx-1 h-3.5 w-px shrink-0 bg-slate-600" />
            )}
            {loading ? (
              <span className="shrink-0 text-slate-400">余额查询中...</span>
            ) : error ? (
              <span className="line-clamp-1 max-w-40 shrink-0 text-red-500">
                余额: {error}
              </span>
            ) : quota ? (
              <span className="shrink-0">
                余额：
                <span className="font-semibold text-slate-100">
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
          </span>
        )}
      </div>
    </Tooltip>
  )
}
