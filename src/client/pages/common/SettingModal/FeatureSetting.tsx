import { Switch } from 'antd'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { t, useAppLanguage } from '../../../i18n'
import { UploadImageSetting } from './UploadImageSetting'

export function FeatureSetting() {
  useAppLanguage()

  const { gptImageSettings, setGptImageSettings } = useLocalSetting()

  const items = [
    {
      key: 'showImageSizeInTaskList' as const,
      label: t('显示图片实际尺寸'),
      description: t('在任务列表的图片左上角显示原始像素尺寸。'),
      checked: gptImageSettings.showImageSizeInTaskList ?? true,
    },
    {
      key: 'autoSaveStudioTasksToTaskList' as const,
      label: t('自动把工作室生成任务存入任务列表'),
      description: t('开启后，工作室完成生成时会同时保留对应的任务记录。'),
      checked: gptImageSettings.autoSaveStudioTasksToTaskList ?? false,
    },
    {
      key: 'autoSelectAspectRatioFromReference' as const,
      label: t('加载参考图后自动选中相近比例'),
      description: t('首次加载参考图时，将模板比例切换到最接近的预设。'),
      checked: gptImageSettings.autoSelectAspectRatioFromReference ?? true,
    },
    {
      key: 'writeGenerationMetadata' as const,
      label: t('写入元数据'),
      description: t('将提示词、模型、尺寸等生成参数写入输出图片。'),
      checked: gptImageSettings.writeGenerationMetadata ?? true,
    },
  ]

  return (
    <div className="space-y-6 px-4 py-2">
      <UploadImageSetting />

      <div className="border-t border-[#303640]" />

      {items.map((item) => (
        <div key={item.key} className="flex items-start justify-between gap-6">
          <div>
            <div>{item.label}</div>
            <div className="mt-1 text-sm text-slate-500">
              {item.description}
            </div>
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
