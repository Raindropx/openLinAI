import { Switch } from 'antd'
import { useLocalSetting } from '../../../hooks/useLocalSetting'

export function FeatureSetting() {
  const { gptImageSettings, setGptImageSettings } = useLocalSetting()

  const items = [
    {
      key: 'showImageSizeInTaskList' as const,
      label: '显示图片实际尺寸',
      description: '在任务列表的图片左上角显示原始像素尺寸。',
      checked: gptImageSettings.showImageSizeInTaskList ?? true,
    },
    {
      key: 'autoSelectAspectRatioFromReference' as const,
      label: '加载参考图后自动选中相近比例',
      description: '首次加载参考图时，将模板比例切换到最接近的预设。',
      checked: gptImageSettings.autoSelectAspectRatioFromReference ?? true,
    },
    {
      key: 'writeGenerationMetadata' as const,
      label: '写入元数据',
      description: '将提示词、模型、尺寸等生成参数写入输出图片。',
      checked: gptImageSettings.writeGenerationMetadata ?? true,
    },
  ]

  return (
    <div className="space-y-6 px-4 py-2">
      {items.map((item) => (
        <div key={item.key} className="flex items-start justify-between gap-6">
          <div>
            <div>{item.label}</div>
            <div className="mt-1 text-sm text-gray-400">{item.description}</div>
          </div>
          <Switch
            checked={item.checked}
            onChange={(checked) =>
              setGptImageSettings((prev) => ({
                ...prev,
                [item.key]: checked,
              }))
            }
          />
        </div>
      ))}
    </div>
  )
}
