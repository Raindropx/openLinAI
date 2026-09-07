import {
  RotateLeftOutlined,
  RotateRightOutlined,
  ScissorOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { Button, Divider, Tooltip } from 'antd'

interface ImageTransformToolbarProps {
  disabled: boolean
  cropMode: boolean
  canApplyCrop: boolean
  onRotateLeft: () => void
  onRotateRight: () => void
  onFlipHorizontal: () => void
  onFlipVertical: () => void
  onStartCrop: () => void
  onCancelCrop: () => void
  onApplyCrop: () => void
}

export function ImageTransformToolbar({
  disabled,
  cropMode,
  canApplyCrop,
  onRotateLeft,
  onRotateRight,
  onFlipHorizontal,
  onFlipVertical,
  onStartCrop,
  onCancelCrop,
  onApplyCrop,
}: ImageTransformToolbarProps) {
  const transformDisabled = disabled || cropMode

  return (
    <div className="flex min-h-12 flex-nowrap items-center gap-1 overflow-x-auto rounded-lg border border-[#343a44] bg-[#20252d] px-2 py-1.5">
      <Tooltip title="向左旋转 90°">
        <Button
          type="text"
          aria-label="向左旋转 90°"
          icon={<RotateLeftOutlined />}
          disabled={transformDisabled}
          onClick={onRotateLeft}
        />
      </Tooltip>
      <Tooltip title="向右旋转 90°">
        <Button
          type="text"
          aria-label="向右旋转 90°"
          icon={<RotateRightOutlined />}
          disabled={transformDisabled}
          onClick={onRotateRight}
        />
      </Tooltip>
      <Tooltip title="水平翻转">
        <Button
          type="text"
          aria-label="水平翻转"
          icon={<SwapOutlined />}
          disabled={transformDisabled}
          onClick={onFlipHorizontal}
        />
      </Tooltip>
      <Tooltip title="垂直翻转">
        <Button
          type="text"
          aria-label="垂直翻转"
          icon={<SwapOutlined className="rotate-90" />}
          disabled={transformDisabled}
          onClick={onFlipVertical}
        />
      </Tooltip>
      <Tooltip title="裁剪">
        <Button
          type={cropMode ? 'primary' : 'text'}
          aria-label="裁剪"
          icon={<ScissorOutlined />}
          disabled={disabled}
          onClick={cropMode ? undefined : onStartCrop}
        />
      </Tooltip>
      {cropMode && (
        <>
          <Divider orientation="vertical" className="h-7!" />
          <Button disabled={disabled} onClick={onCancelCrop}>
            取消裁剪
          </Button>
          <Button
            type="primary"
            disabled={disabled || !canApplyCrop}
            onClick={onApplyCrop}
          >
            应用裁剪
          </Button>
        </>
      )}
    </div>
  )
}
