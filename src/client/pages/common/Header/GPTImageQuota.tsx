import { Tooltip } from 'antd'
import { useMemo } from 'react'
import { useGPTImageQuota } from '../../../hooks/useGPTImageQuota'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../store/global'

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

  // 仅当选中的是云雾 / OpenRouter 类型端点才显示余额
  if (
    !selectedEndpoint ||
    (selectedEndpoint.type !== 'yunwu' &&
      selectedEndpoint.type !== 'openrouter')
  ) {
    return null
  }

  // OpenRouter 余额是美元（已归一化为 total_available），云雾余额需 *0.000001 转元
  const isOpenRouter = selectedEndpoint.type === 'openrouter'
  const currency = isOpenRouter ? '$' : '￥'

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600">
      {loading ? (
        <span>正在获取余额...</span>
      ) : error ? (
        <Tooltip title={error}>
          <span className="line-clamp-1 max-w-50 text-red-500">
            {isOpenRouter ? 'OpenRouter' : '云雾'} 余额: {error}
          </span>
        </Tooltip>
      ) : quota ? (
        <span>
          {isOpenRouter ? 'OpenRouter' : '云雾'} 余额：
          <span className="font-semibold text-slate-800">
            {quota.unlimited_quota
              ? '不限'
              : isOpenRouter
                ? `${currency}${quota.total_available.toFixed(2)}`
                : `${(quota.total_available * 0.000001).toFixed(2)}${currency}`}
          </span>
        </span>
      ) : (
        <span className="text-red-500">
          获取{isOpenRouter ? 'OpenRouter' : '云雾'}余额失败
        </span>
      )}
    </div>
  )
}
