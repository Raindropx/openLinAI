import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import {
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Spin,
  Tag,
  message,
} from 'antd'
import { hc } from 'hono/client'
import { useEffect, useMemo, useState } from 'react'
import type { AppType } from '../../../../../../server'
import builtinData from '../../../../../../../styles_zh.json'
import { useLocalSetting } from '../../../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../../../store/global'
import {
  optimizeStyleTemplate,
  resolveStylePrompt,
} from '../styleOptimize'

interface StylePreset {
  id: string
  name: string
  prompt: string
  source: 'builtin' | 'custom'
  origin?: 'custom' | 'style-extract'
  createdAt?: number
  updatedAt?: number
}

interface PresetFormValue {
  name: string
  prompt: string
}

const client = hc<AppType>('/')
const builtins: StylePreset[] = builtinData.map((item, index) => ({
  ...item,
  id: `builtin-${index}`,
  source: 'builtin',
}))

function injectStyle(template: string, currentPrompt: string) {
  const prompt = currentPrompt.trim()
  if (template.includes('{prompt}')) {
    return resolveStylePrompt(template, prompt)
  }
  return [prompt, template.trim()].filter(Boolean).join('\n')
}

export function StylePresetModal({
  open,
  currentPrompt,
  onClose,
  onApply,
}: {
  open: boolean
  currentPrompt: string
  onClose: () => void
  onApply: (prompt: string) => void
}) {
  const [customPresets, setCustomPresets] = useState<StylePreset[]>([])
  const [selectedId, setSelectedId] = useState(builtins[0]?.id ?? '')
  const [keyword, setKeyword] = useState('')
  const [customOnly, setCustomOnly] = useState(false)
  const [styleExtractOnly, setStyleExtractOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPreset, setEditingPreset] = useState<StylePreset | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [form] = Form.useForm<PresetFormValue>()
  const { llmEndpoints, llmPrompts } = useGlobalStore()
  const { optimizeEndpointId, setOptimizeEndpointId } = useLocalSetting()

  const allPresets = useMemo(
    () => [...customPresets.slice().reverse(), ...builtins],
    [customPresets],
  )
  const selected =
    allPresets.find((preset) => preset.id === selectedId) ?? allPresets[0]
  const preview = selected
    ? injectStyle(selected.prompt, currentPrompt)
    : currentPrompt

  const visiblePresets = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    const sourceFilterEnabled = customOnly || styleExtractOnly
    return allPresets.filter(
      (preset) =>
        (!sourceFilterEnabled ||
          (customOnly &&
            preset.source === 'custom' &&
            preset.origin !== 'style-extract') ||
          (styleExtractOnly && preset.origin === 'style-extract')) &&
        (!normalized ||
          preset.name.toLowerCase().includes(normalized) ||
          preset.prompt.toLowerCase().includes(normalized)),
    )
  }, [allPresets, customOnly, keyword, styleExtractOnly])

  const loadCustomPresets = async () => {
    setLoading(true)
    try {
      const response = await client.api['style-preset'].$get()
      const result = await response.json()
      if (!result.success) throw new Error('自定义预设加载失败')
      setCustomPresets(
        result.data.map((item) => ({
          ...item,
          origin: item.origin ?? 'custom',
          source: 'custom' as const,
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '自定义预设加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void loadCustomPresets()
  }, [open])

  const openEditor = (preset?: StylePreset, copy = false) => {
    const isEditing = preset?.source === 'custom' && !copy
    setEditingPreset(isEditing ? preset : null)
    form.setFieldsValue({
      name: preset ? (isEditing ? preset.name : `${preset.name} - 自定义`) : '',
      prompt: preset?.prompt ?? '{prompt}',
    })
    setEditorOpen(true)
  }

  const savePreset = async () => {
    const values = await form.validateFields()
    setLoading(true)
    try {
      let saved: StylePreset
      if (editingPreset) {
        const response = await client.api['style-preset'][':id'].$put({
            param: { id: editingPreset.id },
            json: values,
          })
        const result = await response.json()
        if (!result.success) throw new Error(result.error)
        saved = { ...result.data, source: 'custom' }
      } else {
        const response = await client.api['style-preset'].$post({ json: values })
        const result = await response.json()
        if (!result.success) throw new Error('预设保存失败')
        saved = { ...result.data, source: 'custom' }
      }
      setCustomPresets((items) =>
        editingPreset
          ? items.map((item) => (item.id === saved.id ? saved : item))
          : [...items, saved],
      )
      setSelectedId(saved.id)
      setEditorOpen(false)
      message.success(editingPreset ? '预设已更新' : '预设已创建')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '预设保存失败')
    } finally {
      setLoading(false)
    }
  }

  const optimizePresetPrompt = async () => {
    const source = form.getFieldValue('prompt')?.trim()
    if (!source) return message.warning('请先输入提示词模板或风格标签')
    const endpointId = optimizeEndpointId || llmEndpoints[0]?.id
    if (!endpointId) return message.warning('请先在设置中配置 LLM 端点')
    if (!llmPrompts.styleOptimizePrompt.trim()) {
      return message.warning('请先在设置中配置风格优化系统提示词')
    }
    if (!optimizeEndpointId) setOptimizeEndpointId(endpointId)
    setOptimizing(true)
    try {
      const result = await optimizeStyleTemplate({
        endpointId,
        systemPrompt: llmPrompts.styleOptimizePrompt,
        source,
      })
      form.setFieldValue('prompt', result)
      message.success('风格模板优化完成')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '风格模板优化失败')
    } finally {
      setOptimizing(false)
    }
  }

  const deletePreset = async (preset: StylePreset) => {
    setLoading(true)
    try {
      const response = await client.api['style-preset'][':id'].$delete({
        param: { id: preset.id },
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error)
      setCustomPresets((items) => items.filter((item) => item.id !== preset.id))
      if (selectedId === preset.id) setSelectedId(builtins[0]?.id ?? '')
      message.success('预设已删除')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '预设删除失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Modal
        title="风格预设"
        open={open}
        onCancel={onClose}
        width="min(1100px, calc(100vw - 16px))"
        centered
        className="[&_.ant-modal-body]:overflow-hidden max-md:[&_.ant-modal-content]:p-3! max-md:[&_.ant-modal-footer]:grid max-md:[&_.ant-modal-footer]:grid-cols-2 max-md:[&_.ant-modal-footer]:gap-2 max-md:[&_.ant-modal-footer_.ant-btn]:m-0! max-md:[&_.ant-modal-footer_.ant-btn]:w-full max-md:[&_.ant-modal-header]:mb-2!"
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={onClose}>取消</Button>,
          <Button
            key="apply"
            type="primary"
            disabled={!selected || !preview}
            onClick={() => onApply(preview)}
          >
            应用到提示词
          </Button>,
        ]}
      >
        <Spin spinning={loading}>
          <div className="grid h-[calc(100dvh-150px)] min-h-0 max-h-170 grid-rows-[250px_minmax(0,1fr)] gap-3 md:h-[min(62vh,560px)] md:grid-cols-[minmax(280px,34%)_minmax(0,1fr)] md:grid-rows-1 md:gap-4">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 p-2 md:p-3">
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜索预设名称或内容"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
              <div className="my-2 flex items-start justify-between gap-2 md:my-3">
                <div className="flex flex-col gap-1">
                  <Checkbox
                    checked={customOnly}
                    onChange={(event) => setCustomOnly(event.target.checked)}
                  >
                    仅显示自定义预设
                  </Checkbox>
                  <Checkbox
                    checked={styleExtractOnly}
                    onChange={(event) =>
                      setStyleExtractOnly(event.target.checked)
                    }
                  >
                    仅显示风格提取预设
                  </Checkbox>
                </div>
                <Button
                  type="link"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => openEditor()}
                >
                  新建
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {visiblePresets.length ? (
                  <List
                    size="small"
                    dataSource={visiblePresets}
                    renderItem={(preset) => (
                      <List.Item
                        className={`cursor-pointer rounded-md px-2! transition-colors ${
                          selected?.id === preset.id
                            ? 'bg-blue-100'
                            : preset.origin === 'style-extract'
                              ? 'bg-purple-50 hover:bg-purple-100'
                              : preset.source === 'custom'
                                ? 'bg-sky-50 hover:bg-sky-100'
                              : 'hover:bg-gray-50'
                        }`}
                        onClick={() => setSelectedId(preset.id)}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{preset.name}</span>
                            {preset.origin === 'style-extract' ? (
                              <Tag color="purple">风格提取</Tag>
                            ) : preset.source === 'custom' ? (
                              <Tag color="blue">自定义</Tag>
                            ) : null}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-gray-400">
                            {preset.prompt}
                          </div>
                        </div>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的预设" />
                )}
              </div>
            </div>

            {selected ? (
              <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1 md:gap-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-semibold">{selected.name}</div>
                    <div className="text-xs text-gray-400">
                      {selected.source === 'builtin'
                        ? '内置预设（只读）'
                        : selected.origin === 'style-extract'
                          ? '来自图片风格提取'
                          : '用户自定义预设'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => openEditor(selected, true)}
                    >
                      {selected.source === 'builtin' ? '复制为自定义' : '复制'}
                    </Button>
                    {selected.source === 'custom' && (
                      <>
                        <Button icon={<EditOutlined />} onClick={() => openEditor(selected)}>编辑</Button>
                        <Popconfirm
                          title="删除这个自定义预设？"
                          description="删除后无法恢复。"
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => deletePreset(selected)}
                        >
                          <Button danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <div className="mb-1 text-sm text-gray-500">预设模板</div>
                  <Input.TextArea
                    value={selected.prompt}
                    readOnly
                    autoSize={{ minRows: 3, maxRows: 6 }}
                  />
                </div>
                <div className="min-h-0 flex-1">
                  <div className="mb-1 text-sm text-gray-500">注入结果预览</div>
                  <Input.TextArea
                    value={preview}
                    readOnly
                    className="h-32! md:h-64!"
                  />
                  <div className="mt-1 text-xs text-gray-400">
                    模板中的 {'{prompt}'} 会替换为当前提示词，当前提示词为空时使用“此画面”；没有占位符时会追加到当前提示词之后。
                  </div>
                </div>
              </div>
            ) : (
              <Empty description="请选择一个预设" />
            )}
          </div>
        </Spin>
      </Modal>

      <Modal
        title={editingPreset ? '编辑自定义预设' : '新建自定义预设'}
        open={editorOpen}
        width="min(620px, calc(100vw - 16px))"
        centered
        className="max-md:[&_.ant-modal-body]:max-h-[calc(100dvh-180px)] max-md:[&_.ant-modal-body]:overflow-y-auto max-md:[&_.ant-modal-content]:p-3! max-md:[&_.ant-modal-footer]:grid max-md:[&_.ant-modal-footer]:grid-cols-2 max-md:[&_.ant-modal-footer]:gap-2 max-md:[&_.ant-modal-footer_.ant-btn]:m-0! max-md:[&_.ant-modal-footer_.ant-btn]:w-full"
        onCancel={() => setEditorOpen(false)}
        onOk={() => void savePreset()}
        confirmLoading={loading}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="预设名称"
            rules={[{ required: true, whitespace: true, message: '请输入预设名称' }]}
          >
            <Input maxLength={80} showCount placeholder="例如：柔和日系摄影" />
          </Form.Item>
          <Form.Item
            name="prompt"
            label={
              <div className="flex w-full items-center justify-between gap-2">
                <span>提示词模板</span>
                <Button
                  type="link"
                  size="small"
                  icon={<RobotOutlined />}
                  loading={optimizing}
                  onClick={() => void optimizePresetPrompt()}
                >
                  AI 优化
                </Button>
              </div>
            }
            className="[&_.ant-form-item-label>label]:h-auto! [&_.ant-form-item-label>label]:w-full"
            extra="使用 {prompt} 表示原提示词；不使用占位符时，模板会追加到原提示词后。"
            rules={[{ required: true, whitespace: true, message: '请输入提示词模板' }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 6, maxRows: 12 }}
              maxLength={20000}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
