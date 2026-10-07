import { Button, Form, Select } from 'antd'
import type { GptImageEndpoint } from '../../../../server/common/config'
import {
  GEMINI_SAFETY_CATEGORIES,
  GEMINI_SAFETY_LABELS,
  type GeminiSafetyThreshold,
} from '../../../../shared/gemini'
import { t } from '../../../i18n'

const levels: Array<{ value: GeminiSafetyThreshold | ''; label: string; description: string }> = [
  {
    value: '', label: '默认（由模型决定）',
    description: '沿用当前模型的默认过滤规则。',
  },
  {
    value: 'OFF', label: '关闭额外过滤',
    description: '关闭这一类可调安全过滤；Google 的内置保护仍然生效。',
  },
  {
    value: 'BLOCK_NONE', label: '不按安全评分拦截',
    description: '无论模型给出什么违规概率，都不因这一类评分拦截；内置保护仍然生效。',
  },
  {
    value: 'BLOCK_ONLY_HIGH', label: '宽松（较少拦截）',
    description: '只有模型认为内容很可能违规时，才会拦截。',
  },
  {
    value: 'BLOCK_MEDIUM_AND_ABOVE', label: '适中（部分拦截）',
    description: '模型认为内容有中等或较高可能违规时，就会拦截。',
  },
  {
    value: 'BLOCK_LOW_AND_ABOVE', label: '严格（较多拦截）',
    description: '模型认为内容有少量违规可能时，也会拦截，更容易误拦。',
  },
]

export function GeminiEndpointSettings({
  endpoint,
  onChange,
}: {
  endpoint: GptImageEndpoint
  onChange: (patch: Partial<GptImageEndpoint>) => void
}) {
  return (
    <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 text-sm font-medium">{t('Gemini 安全过滤')}</div>
      <div className="mb-3 text-xs text-slate-500">
        {t('分别控制四类内容的拦截力度，文生图和参考图编辑都会使用。保存设置后生效。')}
        <br />
        {t('过滤等级依据模型判断的违规可能性，不代表内容危害的严重程度；关闭额外过滤也不会关闭所有内置保护。')}
      </div>
      <div className="grid gap-x-3 md:grid-cols-2">
        {GEMINI_SAFETY_CATEGORIES.map((category) => {
          const value = endpoint.geminiSafetySettings?.[category] || ''
          const level = levels.find((item) => item.value === value) || levels[0]
          return (
            <Form.Item
              key={category}
              label={t(GEMINI_SAFETY_LABELS[category])}
              extra={t(level.description)}
            >
              <Select<GeminiSafetyThreshold | ''>
                value={value}
                options={levels.map((item) => ({ value: item.value, label: t(item.label) }))}
                onChange={(threshold) => {
                  const settings = { ...endpoint.geminiSafetySettings }
                  if (threshold) settings[category] = threshold
                  else delete settings[category]
                  onChange({
                    geminiSafetySettings: Object.keys(settings).length ? settings : undefined,
                  })
                }}
              />
            </Form.Item>
          )
        })}
      </div>
      <Button size="small" onClick={() => onChange({ geminiSafetySettings: undefined })}>
        {t('全部恢复默认过滤')}
      </Button>
    </div>
  )
}

export function GeminiBalanceHelp() {
  return (
    <div className="mb-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-1 text-sm font-medium">{t('Google 官方余额与账单')}</div>
      <div className="mb-2 text-xs text-slate-500">
        {t('当前无法仅凭 Gemini API Key 在这里查询 Google 官方余额，请登录 Google AI Studio 查看余额、用量和账单。')}
        <br />
        {t('如果使用中转服务，只有服务商提供余额查询接口时，才需要开启下方的自定义余额查询。')}
      </div>
      <Button size="small" href="https://aistudio.google.com/billing" target="_blank" rel="noopener noreferrer">
        {t('打开 Google 官方账单')}
      </Button>
    </div>
  )
}
