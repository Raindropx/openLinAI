import {
  MinusCircleOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Slider,
  Space,
  Switch,
  message,
} from 'antd'
import { useEffect, useState } from 'react'
import type { StudioItem } from '../../../../shared/studio'
import {
  NOVELAI_IMAGE_MODELS,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
  type NovelAIStudioGenerateRequest,
  type StudioProviderSettings,
} from '../../../../shared/studio-generation'
import {
  generateNovelAIStudioImages,
  testStudioProvider,
  updateNovelAISettings,
} from './api'
import { ProviderKeyCard } from './ProviderKeyCard'

const INITIAL_VALUES: NovelAIStudioGenerateRequest = {
  title: 'NovelAI Studio',
  prompt: '',
  negativePrompt: '',
  model: 'nai-diffusion-5-full',
  width: 1024,
  height: 1024,
  steps: 28,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler',
  noiseSchedule: 'karras',
  seed: -1,
  n: 1,
  qualityToggle: false,
  characters: [],
}

export function NovelAIStudio({
  settings,
  onSettings,
  onItems,
}: {
  settings: StudioProviderSettings['novelai']
  onSettings: (settings: StudioProviderSettings) => void
  onItems: (items: StudioItem[]) => void
}) {
  const [form] = Form.useForm<NovelAIStudioGenerateRequest>()
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    form.setFieldValue('model', settings.model)
  }, [form, settings.model])

  async function generate() {
    if (!settings.configured) {
      message.warning('请先保存 NovelAI API Token')
      return
    }
    const values = await form.validateFields()
    setGenerating(true)
    try {
      const result = await generateNovelAIStudioImages(values)
      onItems(result.items)
      message.success(`NovelAI 已生成 ${result.items.length} 张图片`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'NovelAI 生成失败')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="studio-provider-panel">
      <ProviderKeyCard
        provider="NovelAI"
        configured={settings.configured}
        keyHint={settings.keyHint}
        onSave={async (apiKey) =>
          onSettings(await updateNovelAISettings({ apiKey }))
        }
        onClear={async () =>
          onSettings(await updateNovelAISettings({ clearApiKey: true }))
        }
        onTest={async () => {
          await testStudioProvider('novelai')
          return undefined
        }}
      />
      <Alert
        showIcon
        type="info"
        title="首阶段已接入原生文生图、UC 与角色提示词"
        description="角色精密参考、Vibe Transfer、图生图与局部重绘会在后续阶段接入暂存台素材。"
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ...INITIAL_VALUES, model: settings.model }}
        className="studio-generation-form"
      >
        <div className="studio-form-grid studio-form-grid-wide">
          <Form.Item label="任务名称" name="title">
            <Input maxLength={120} placeholder="NovelAI Studio" />
          </Form.Item>
          <Form.Item label="模型" name="model" rules={[{ required: true }]}>
            <Select
              options={NOVELAI_IMAGE_MODELS.map((model) => ({
                label: model.name,
                value: model.id,
              }))}
              onChange={(model) => {
                void updateNovelAISettings({ model })
                  .then(onSettings)
                  .catch((error) =>
                    message.error(
                      error instanceof Error
                        ? error.message
                        : '默认模型保存失败',
                    ),
                  )
              }}
            />
          </Form.Item>
        </div>
        <Form.Item
          label="提示词"
          name="prompt"
          rules={[{ required: true, message: '请输入提示词' }]}
        >
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} />
        </Form.Item>
        <Form.Item label="UC（Undesired Content）" name="negativePrompt">
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 8 }}
            placeholder="不希望出现在画面中的内容"
          />
        </Form.Item>
        <Form.List name="characters">
          {(fields, { add, remove }) => (
            <div className="studio-character-list">
              <div className="studio-section-heading">
                <div>
                  <strong>角色提示词</strong>
                  <small>V4/V5 将每个角色独立送入 Character Prompt</small>
                </div>
                <Button icon={<PlusOutlined />} onClick={() => add()}>
                  添加角色
                </Button>
              </div>
              {fields.map((field, index) => (
                <div className="studio-character-card" key={field.key}>
                  <div className="studio-character-title">
                    <strong>角色 {index + 1}</strong>
                    <Button
                      danger
                      type="text"
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </div>
                  <Form.Item
                    label="角色提示词"
                    name={[field.name, 'prompt']}
                    rules={[{ required: true, message: '请输入角色提示词' }]}
                  >
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
                  </Form.Item>
                  <Form.Item
                    label="角色 UC"
                    name={[field.name, 'negativePrompt']}
                  >
                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} />
                  </Form.Item>
                </div>
              ))}
            </div>
          )}
        </Form.List>
        <Collapse
          ghost
          items={[
            {
              key: 'advanced',
              label: '高级生成参数',
              children: (
                <>
                  <div className="studio-form-grid">
                    <Form.Item label="宽度" name="width">
                      <InputNumber min={64} max={2048} step={64} />
                    </Form.Item>
                    <Form.Item label="高度" name="height">
                      <InputNumber min={64} max={2048} step={64} />
                    </Form.Item>
                    <Form.Item label="步数" name="steps">
                      <InputNumber min={1} max={50} />
                    </Form.Item>
                    <Form.Item label="种子（-1 为随机）" name="seed">
                      <InputNumber min={-1} max={2147483647} />
                    </Form.Item>
                    <Form.Item label="采样器" name="sampler">
                      <Select
                        options={NOVELAI_SAMPLERS.map((value) => ({
                          label: value,
                          value,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item label="噪声调度" name="noiseSchedule">
                      <Select
                        options={NOVELAI_NOISE_SCHEDULES.map((value) => ({
                          label: value,
                          value,
                        }))}
                      />
                    </Form.Item>
                  </div>
                  <div className="studio-slider-grid">
                    <Form.Item label="CFG Scale" name="scale">
                      <Slider min={0} max={10} step={0.1} />
                    </Form.Item>
                    <Form.Item label="CFG Rescale" name="cfgRescale">
                      <Slider min={0} max={1} step={0.05} />
                    </Form.Item>
                  </div>
                  <Space size="large" wrap>
                    <Form.Item label="生成张数" name="n">
                      <InputNumber min={1} max={4} />
                    </Form.Item>
                    <Form.Item
                      label="自动质量标签"
                      name="qualityToggle"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>
                  </Space>
                </>
              ),
            },
          ]}
        />
        <Button
          type="primary"
          size="large"
          icon={<ThunderboltOutlined />}
          loading={generating}
          disabled={!settings.configured}
          onClick={() => void generate()}
        >
          生成到暂存台
        </Button>
      </Form>
    </div>
  )
}
