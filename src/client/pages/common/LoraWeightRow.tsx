import { DeleteOutlined } from '@ant-design/icons'
import { Button, InputNumber } from 'antd'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

/** Shared by Civitai resources and providers that load LoRA weights by URL. */
export function LoraWeightRow({
  label,
  editor,
  value,
  min,
  max,
  onChange,
  onRemove,
}: {
  label: string
  editor?: ReactNode
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  onRemove: () => void
}) {
  return (
    <div className="mb-2 grid min-w-0 grid-cols-[minmax(0,1fr)_72px_32px] items-center gap-1.5">
      {editor || (
        <span className="truncate" title={label}>
          {label}
        </span>
      )}
      <InputNumber
        className="w-full"
        aria-label={t('{0} 权重', [label])}
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(strength) => onChange(strength ?? 1)}
      />
      <Button
        aria-label={t('移除 {0}', [label])}
        icon={<DeleteOutlined />}
        onClick={onRemove}
      />
    </div>
  )
}
