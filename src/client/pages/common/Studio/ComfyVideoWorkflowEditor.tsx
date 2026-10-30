import { DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Upload,
} from 'antd'
import { useRef, useState } from 'react'
import {
  COMFY_VIDEO_SOURCES,
  comfyVideoSchema,
  type ComfyVideoConfig,
} from '../../../../shared/comfyui-video'
import { t } from '../../../i18n'

const labels: Record<(typeof COMFY_VIDEO_SOURCES)[number], string> = {
  prompt: '提示词',
  image: '输入图片',
  durationSeconds: '时长（秒）',
  width: '宽度',
  height: '高度',
  frameCount: '总帧数',
  fps: '帧率',
  seed: '随机种子',
  resolution: '分辨率',
  aspectRatio: '画面比例',
}
export function ComfyVideoWorkflowEditor({
  value,
  onChange,
}: {
  value?: ComfyVideoConfig
  onChange: (value: ComfyVideoConfig | undefined) => void
}) {
  const [raw, setRaw] = useState(
    value ? JSON.stringify(value.workflow, null, 2) : '',
  )
  const [error, setError] = useState('')
  const previous = useRef(value)
  const change = (config: ComfyVideoConfig) => {
    previous.current = config
    onChange(config)
  }
  const parse = (text: string) => {
    setRaw(text)
    try {
      if (new Blob([text]).size > 2 * 1024 * 1024)
        throw new Error(t('工作流文件不能超过 2 MiB'))
      const workflow = JSON.parse(text)
      const check = comfyVideoSchema.shape.workflow.safeParse(workflow)
      if (!check.success)
        throw new Error(
          t('请导入 ComfyUI 导出的 API 格式工作流（非画布 JSON）'),
        )
      const same =
        JSON.stringify(check.data) ===
        JSON.stringify(previous.current?.workflow)
      change({
        workflow: check.data,
        bindings: same ? previous.current?.bindings || [] : [],
        fps: previous.current?.fps || 24,
        frameCountOffset: previous.current?.frameCountOffset ?? 1,
        outputNodeId: same ? previous.current?.outputNodeId : undefined,
      })
      setError('')
    } catch (cause) {
      setError((cause as Error).message)
      onChange(undefined)
    }
  }
  const nodes = Object.entries(value?.workflow || {})
  return (
    <>
      <Alert
        type="info"
        showIcon
        title={t(
          '在 ComfyUI 中导出 API 格式工作流，再导入并映射输入。模型与采样参数由工作流决定；不同输入模式请分别保存端点。',
        )}
      />
      <Upload
        accept=".json,application/json"
        showUploadList={false}
        beforeUpload={async (file) => {
          if (file.size > 2 * 1024 * 1024) {
            setError(t('工作流文件不能超过 2 MiB'))
            return false
          }
          parse(await file.text())
          return false
        }}
      >
        <Button icon={<UploadOutlined />} style={{ margin: '12px 0' }}>
          {t('导入 API 工作流')}
        </Button>
      </Upload>
      <Input.TextArea
        aria-label={t('API 工作流 JSON')}
        value={raw}
        rows={6}
        placeholder={t('粘贴 API 工作流 JSON')}
        onChange={(event) => parse(event.target.value)}
      />
      {error && (
        <Alert type="error" showIcon title={error} style={{ marginTop: 8 }} />
      )}
      {value && (
        <>
          <p>{t('将页面参数映射到节点输入；未映射的输入保留工作流原值。')}</p>
          {value.bindings.map((binding, index) => {
            const update = (
              fields: Partial<ComfyVideoConfig['bindings'][number]>,
            ) =>
              change({
                ...value,
                bindings: value.bindings.map((item, i) =>
                  i === index ? { ...item, ...fields } : item,
                ),
              })
            return (
              <Space
                key={index}
                wrap
                style={{ display: 'flex', marginBottom: 8 }}
              >
                <Select
                  aria-label={t('参数来源')}
                  style={{ width: 130 }}
                  value={binding.source}
                  options={COMFY_VIDEO_SOURCES.map((source) => ({
                    value: source,
                    label: t(labels[source]),
                  }))}
                  onChange={(source) => update({ source })}
                />
                <Select
                  aria-label={t('工作流节点')}
                  style={{ width: 210 }}
                  showSearch
                  optionFilterProp="label"
                  value={binding.nodeId || undefined}
                  placeholder={t('工作流节点')}
                  options={nodes.map(([id, node]) => ({
                    value: id,
                    label: `${id} · ${node._meta?.title || node.class_type}`,
                  }))}
                  onChange={(nodeId) => update({ nodeId, input: '' })}
                />
                <Select
                  aria-label={t('节点输入')}
                  style={{ width: 150 }}
                  value={binding.input || undefined}
                  placeholder={t('节点输入')}
                  options={Object.entries(
                    value.workflow[binding.nodeId]?.inputs || {},
                  )
                    .filter(([, item]) => !Array.isArray(item))
                    .map(([key]) => ({ value: key, label: key }))}
                  onChange={(input) => update({ input })}
                />
                {binding.source === 'image' && (
                  <InputNumber
                    aria-label={t('图片序号（从 1 开始）')}
                    min={1}
                    max={16}
                    value={(binding.imageIndex ?? 0) + 1}
                    onChange={(number) =>
                      update({ imageIndex: (number || 1) - 1 })
                    }
                  />
                )}
                <Button
                  aria-label={t('删除映射')}
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    change({
                      ...value,
                      bindings: value.bindings.filter((_, i) => i !== index),
                    })
                  }
                />
              </Space>
            )
          })}
          <Button
            icon={<PlusOutlined />}
            onClick={() =>
              change({
                ...value,
                bindings: [
                  ...value.bindings,
                  { nodeId: '', input: '', source: 'prompt' },
                ],
              })
            }
          >
            {t('添加参数映射')}
          </Button>
          <Form.Item
            label={t('视频输出节点')}
            style={{ marginTop: 12 }}
            extra={t(
              '留空时选择第一个 MP4/WebM 输出；支持原生 SaveVideo、SaveWEBM 和 VideoHelperSuite。',
            )}
          >
            <Select
              allowClear
              value={value.outputNodeId}
              options={nodes.map(([id, node]) => ({
                value: id,
                label: `${id} · ${node._meta?.title || node.class_type}`,
              }))}
              onChange={(outputNodeId) => change({ ...value, outputNodeId })}
            />
          </Form.Item>
          <Space wrap align="start">
            <Form.Item label={t('帧率')}>
              <InputNumber
                min={1}
                max={120}
                value={value.fps}
                onChange={(fps) => change({ ...value, fps: fps || 24 })}
              />
            </Form.Item>
            <Form.Item
              label={t('总帧数偏移')}
              extra={t(
                '总帧数 = 四舍五入（时长 × 帧率）+ 偏移；按工作流要求选择。',
              )}
            >
              <Select
                style={{ width: 100 }}
                value={value.frameCountOffset}
                options={[-1, 0, 1].map((n) => ({
                  value: n,
                  label: String(n),
                }))}
                onChange={(frameCountOffset) =>
                  change({ ...value, frameCountOffset })
                }
              />
            </Form.Item>
          </Space>
        </>
      )}
    </>
  )
}
