import { AutoComplete, Button } from 'antd'
import type { EndpointModelOption } from '../../../hooks/useEndpointModels'

interface ModelIdInputProps {
  value?: string
  onChange: (value: string) => void
  models: EndpointModelOption[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  placeholder: string
  directoryLabel?: string
  waitingForKey?: boolean
  allowClear?: boolean
}

export function ModelIdInput({
  value,
  onChange,
  models,
  loading,
  error,
  onRefresh,
  placeholder,
  directoryLabel = '模型目录',
  waitingForKey = false,
  allowClear = false,
}: ModelIdInputProps) {
  return (
    <>
      <AutoComplete
        value={value || undefined}
        onChange={onChange}
        options={models.map((model) => ({
          value: model.id,
          label:
            model.name && model.name !== model.id
              ? `${model.name} (${model.id})`
              : model.id,
        }))}
        filterOption={(inputValue, option) => {
          const query = inputValue.toLowerCase()
          return Boolean(
            option?.value.toLowerCase().includes(query) ||
              String(option?.label || '')
                .toLowerCase()
                .includes(query),
          )
        }}
        placeholder={placeholder}
        allowClear={allowClear}
        className="w-full"
      />
      {loading && (
        <div className="mt-1 text-xs text-slate-500">
          正在刷新{directoryLabel}…输入内容仍会保留为模型 ID。
        </div>
      )}
      {error && (
        <div className="mt-1 flex items-center gap-2 text-xs text-red-500">
          <span>
            {directoryLabel}：{error}
          </span>
          <Button
            type="link"
            size="small"
            className="h-auto p-0"
            onClick={onRefresh}
          >
            重试
          </Button>
        </div>
      )}
      {waitingForKey && !loading && !error && (
        <div className="mt-1 text-xs text-slate-500">
          可直接输入模型 ID；填写 API Key 后会自动载入可搜索目录。
        </div>
      )}
      {!waitingForKey && !loading && !error && models.length > 0 && (
        <div className="mt-1 text-xs text-slate-500">
          可选择目录项；无匹配项时，当前输入文本会直接作为模型 ID。
        </div>
      )}
    </>
  )
}
