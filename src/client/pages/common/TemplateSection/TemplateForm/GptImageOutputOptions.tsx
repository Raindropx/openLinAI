import { Alert, Button, Form, Input, InputNumber, Select } from 'antd'
import {
  GPT_IMAGE_GIF_MAX_FRAMES,
  supportsGptImageOptions,
  validateGptImageOptions,
  type GptImageOptions,
} from '../../../../../shared/gpt-image-options'
import { useEnabledImageEndpoints } from '../../../../hooks/useEnabledImageEndpoints'
import { t, useAppLanguage } from '../../../../i18n'

export function GptImageOutputOptions({ imageCount }: { imageCount: number }) {
  useAppLanguage()
  const form = Form.useFormInstance()
  const endpointId = Form.useWatch('endpointId', form)
  const options = Form.useWatch('gptImageOptions', { form, preserve: true }) as
    | GptImageOptions
    | undefined
  const n = Form.useWatch('n', form) || 1
  const endpoints = useEnabledImageEndpoints()
  const endpoint = endpoints.find((item) => item.id === endpointId)
  const supported =
    endpoint && supportsGptImageOptions(endpoint, imageCount > 0)
  const hasOptions =
    options && Object.values(options).some((value) => value !== undefined)
  if (!supported && !hasOptions) return null
  const error =
    endpoint && validateGptImageOptions(options, endpoint, imageCount, n)
  const format = options?.outputFormat || 'png'

  return (
    <div className="mb-4 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2">
      {error && (
        <Alert className="col-span-2" type="warning" title={t(error)} />
      )}
      {!supported ? (
        <Button
          className="col-span-2"
          onClick={() => form.setFieldValue('gptImageOptions', {})}
        >
          {t('使用默认输出')}
        </Button>
      ) : (
        <>
          <Form.Item
            name={['gptImageOptions', 'outputFormat']}
            label={t('输出格式')}
            className="mb-0!"
          >
            <Select
              placeholder="PNG"
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPEG' },
                { value: 'webp', label: 'WebP' },
                {
                  value: 'gif',
                  label: t('GIF 动图'),
                },
                {
                  value: 'svg',
                  label: t('SVG 矢量图'),
                },
              ]}
              onChange={(value) => {
                if (value !== 'svg')
                  form.setFieldValue(['gptImageOptions', 'svgModel'], undefined)
                if (value !== 'gif') {
                  form.setFieldValue(
                    ['gptImageOptions', 'frameCount'],
                    undefined,
                  )
                  form.setFieldValue(
                    ['gptImageOptions', 'frameDurationMs'],
                    undefined,
                  )
                }
                if (value === 'svg') form.setFieldValue('n', 1)
              }}
            />
          </Form.Item>
          <Form.Item
            name={['gptImageOptions', 'complexity']}
            label={t('规划复杂度')}
            className="mb-0!"
          >
            <Select
              allowClear
              placeholder={t('模型默认')}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
          </Form.Item>
          {format === 'gif' && (
            <>
              <Form.Item
                name={['gptImageOptions', 'frameCount']}
                label={t('动画帧数')}
                preserve={false}
                getValueFromEvent={(value) => value ?? undefined}
                className="mb-0!"
              >
                <InputNumber
                  min={2}
                  max={GPT_IMAGE_GIF_MAX_FRAMES}
                  precision={0}
                  placeholder="9"
                  className="w-full!"
                />
              </Form.Item>
              <Form.Item
                name={['gptImageOptions', 'frameDurationMs']}
                label={t('每帧时长（毫秒）')}
                preserve={false}
                getValueFromEvent={(value) => value ?? undefined}
                className="mb-0!"
              >
                <InputNumber
                  min={20}
                  max={2000}
                  step={10}
                  precision={0}
                  placeholder="200"
                  className="w-full!"
                />
              </Form.Item>
              <div className="col-span-2 text-xs text-slate-400">
                {t(
                  '支持静态参考图。默认 9 帧、每帧 200 毫秒，帧数可设为 2–16。GIF 尺寸由模型自动选择，预览保留动画；请在提示词中描述动作和循环。',
                )}
              </div>
            </>
          )}
          {format === 'svg' && (
            <div className="col-span-2">
              <Form.Item
                name={['gptImageOptions', 'svgModel']}
                label={t('SVG 作者模型')}
                preserve={false}
                extra={t(
                  '填写上游支持的 SVG 作者模型 ID；留空使用上游默认。提示缺少 svg.model 时需填写，作者模型可能单独计费。',
                )}
              >
                <Input
                  maxLength={200}
                  allowClear
                  placeholder={t('留空使用上游默认')}
                />
              </Form.Item>
              <div className="text-xs text-slate-400">
                {t(
                  'SVG 可使用参考图，每次一张，下载保留矢量格式；需要上游模型和账号开通 SVG 权限。',
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
