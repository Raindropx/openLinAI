import {
  CheckOutlined,
  DeleteOutlined,
  RedoOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { Button, ColorPicker, Divider, Slider, Tooltip } from 'antd'
import { t, useAppLanguage } from '../../../../../i18n'

const DRAW_COLOR_PRESETS = [
  {
    color: '#ff4d4f',
    get label() {
      return t('红色画笔')
    },
  },
  {
    color: '#fadb14',
    get label() {
      return t('黄色画笔')
    },
  },
  {
    color: '#1677ff',
    get label() {
      return t('蓝色画笔')
    },
  },
  {
    color: '#000000',
    get label() {
      return t('黑色画笔')
    },
  },
  {
    color: '#ffffff',
    get label() {
      return t('白色画笔')
    },
  },
]

export const DEFAULT_DRAW_COLOR = DRAW_COLOR_PRESETS[0].color

interface ImageDrawToolbarProps {
  color: string
  brushSize: number
  zoom: number
  submitting: boolean
  zoomDisabled: boolean
  canUndo: boolean
  canRedo: boolean
  canReset: boolean
  onColorChange: (color: string) => void
  onBrushSizeChange: (size: number) => void
  onRestoreZoom: () => void
  onUndo: () => void
  onRedo: () => void
  onReset: () => void
  presetColors?: string[]
  compact?: boolean
}

export function ImageDrawToolbar({
  color,
  brushSize,
  zoom,
  submitting,
  zoomDisabled,
  canUndo,
  canRedo,
  canReset,
  onColorChange,
  onBrushSizeChange,
  onRestoreZoom,
  onUndo,
  onRedo,
  onReset,
  presetColors,
  compact = false,
}: ImageDrawToolbarProps) {
  useAppLanguage()

  return (
    <div className={compact
      ? 'flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800'
      : 'flex flex-nowrap items-center gap-2 overflow-x-auto rounded-lg border border-[#343a44] bg-[#20252d] p-2'}>
      {presetColors === undefined && DRAW_COLOR_PRESETS.map((preset) => (
        <Tooltip key={preset.color} title={preset.label}>
          <button
            type="button"
            aria-label={preset.label}
            disabled={submitting}
            className="relative h-7 w-7 shrink-0 cursor-pointer rounded-full border border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: preset.color,
              outline:
                color === preset.color
                  ? '2px solid var(--app-accent)'
                  : undefined,
              outlineOffset: 2,
            }}
            onClick={() => onColorChange(preset.color)}
          >
            {color === preset.color && (
              <CheckOutlined
                className={
                  preset.color === '#ffffff' ? 'text-slate-700' : 'text-white'
                }
              />
            )}
          </button>
        </Tooltip>
      ))}
      <Tooltip title={t('自定义画笔颜色')}>
        <ColorPicker
          value={color}
          disabled={submitting}
          disabledAlpha
          format={compact ? 'hex' : undefined}
          size={compact ? 'small' : undefined}
          aria-label={t('自定义画笔颜色')}
          presets={presetColors === undefined ? undefined : [{ label: t('拼豆常用色'), colors: presetColors, defaultOpen: true }]}
          onChange={(value) => onColorChange(value.toHexString())}
        />
      </Tooltip>
      <Divider orientation="vertical" className="h-7!" />
      <span className={compact ? 'shrink-0 text-xs' : 'shrink-0 text-sm'}>{t('画笔大小')}</span>
      <Slider
        min={4}
        max={64}
        step={2}
        value={brushSize}
        disabled={submitting}
        className={compact ? 'mx-1! w-20 shrink-0' : 'w-32 shrink-0'}
        onChange={onBrushSizeChange}
      />
      <span className={compact ? 'w-10 shrink-0 text-xs tabular-nums' : 'w-12 shrink-0 text-sm tabular-nums'}>{brushSize} px</span>
      <Tooltip title={t('滚轮缩放，点击恢复 100%')}>
        <Button
          size={compact ? 'small' : undefined}
          type="text"
          disabled={submitting || zoomDisabled}
          onClick={onRestoreZoom}
        >
          {Math.round(zoom * 100)}%
        </Button>
      </Tooltip>
      <Divider orientation="vertical" className="h-7!" />
      <Tooltip title={t('撤销')}>
        <Button
          type="text"
          aria-label={t('撤销')}
          size={compact ? 'small' : undefined}
          icon={<UndoOutlined />}
          disabled={submitting || !canUndo}
          onClick={onUndo}
        />
      </Tooltip>
      <Tooltip title={t('重做')}>
        <Button
          type="text"
          aria-label={t('重做')}
          size={compact ? 'small' : undefined}
          icon={<RedoOutlined />}
          disabled={submitting || !canRedo}
          onClick={onRedo}
        />
      </Tooltip>
      <Tooltip title={t('还原原图')}>
        <Button
          type="text"
          aria-label={t('还原原图')}
          size={compact ? 'small' : undefined}
          icon={<DeleteOutlined />}
          disabled={submitting || !canReset}
          onClick={onReset}
        />
      </Tooltip>
    </div>
  )
}
