import { Switch } from 'antd'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { t, useAppLanguage } from '../../../i18n'
import { UploadImageSetting } from './UploadImageSetting'

export function FeatureSetting() {
  useAppLanguage()

  const { gptImageSettings, setGptImageSettings } = useLocalSetting()

  const items = [
    {
      key: 'streamTaskDownloads' as const,
      label: t('流式打包下载'),
      description: t(
        '用于批量图片下载和任务列表备份/恢复。开启后，ZIP 下载由服务器边打包边发送，恢复时分块接收并逐项校验；关闭后使用普通下载和备份/恢复。此设置保存在当前浏览器。',
      ),
      checked: gptImageSettings.streamTaskDownloads ?? true,
    },
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
      key: 'sendAspectRatioToPromptOptimize' as const,
      label: t('提示词优化时发送画面比例'),
      description: t(
        '向提示词优化 LLM 附加当前设定的比例；开启提示词注入时不会重复发送。关闭后不自动附加比例。',
      ),
      checked: gptImageSettings.sendAspectRatioToPromptOptimize ?? true,
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
            aria-label={item.label}
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
