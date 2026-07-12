import { PlusOutlined } from '@ant-design/icons'
import { Button, Form, Input, message, Select } from 'antd'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { LlmEndpoint, LlmPrompts } from '../../../../server/common/config'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../store/global'

export interface LlmSettingRef {
  save: () => Promise<void>
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'google/gemini-3-pro'

const createEmptyEndpoint = (): LlmEndpoint => ({
  id: uuidv4(),
  name: '',
  baseURL: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
  apiKey: '',
})

export const LlmSetting = forwardRef<LlmSettingRef>((_props, ref) => {
  const { llmEndpoints, llmPrompts, saveLlmEndpoints, saveLlmPrompts } =
    useGlobalStore()
  const {
    optimizeEndpointId,
    setOptimizeEndpointId,
    charCardEndpointId,
    setCharCardEndpointId,
  } = useLocalSetting()

  // 本地编辑态
  const [draftEndpoints, setDraftEndpoints] = useState<LlmEndpoint[]>(
    llmEndpoints.length ? llmEndpoints : [createEmptyEndpoint()],
  )
  const [activeId, setActiveId] = useState<string>(
    draftEndpoints[0]?.id || '',
  )
  const [draftPrompts, setDraftPrompts] =
    useState<LlmPrompts>(llmPrompts)

  // 配置变化时同步草稿
  useEffect(() => {
    if (llmEndpoints.length) {
      setDraftEndpoints(llmEndpoints)
      if (!llmEndpoints.find((e) => e.id === activeId)) {
        setActiveId(llmEndpoints[0].id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmEndpoints])

  useEffect(() => {
    setDraftPrompts(llmPrompts)
  }, [llmPrompts])

  const activeEndpoint =
    draftEndpoints.find((e) => e.id === activeId) || draftEndpoints[0]

  const updateActiveEndpoint = (patch: Partial<LlmEndpoint>) => {
    setDraftEndpoints((list) =>
      list.map((e) => (e.id === activeEndpoint.id ? { ...e, ...patch } : e)),
    )
  }

  const handleAddEndpoint = () => {
    const ep = createEmptyEndpoint()
    setDraftEndpoints((list) => [...list, ep])
    setActiveId(ep.id)
  }

  const handleDeleteEndpoint = (id: string) => {
    setDraftEndpoints((list) => {
      const next = list.filter((e) => e.id !== id)
      if (next.length === 0) {
        const fresh = createEmptyEndpoint()
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) {
        setActiveId(next[0].id)
      }
      // 删除的端点若被指定为提示词优化/角色卡生成端点，回退到第一个
      if (id === optimizeEndpointId) {
        setOptimizeEndpointId(next[0].id)
      }
      if (id === charCardEndpointId) {
        setCharCardEndpointId(next[0].id)
      }
      return next
    })
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      const cleaned = draftEndpoints
        .map((e) => ({ ...e, name: e.name.trim() }))
        .filter((e) => e.name && e.baseURL && e.model && e.apiKey)
      if (cleaned.length === 0) {
        message.warning('请至少完整配置一个 LLM 端点（名称/地址/模型/Key）')
        throw new Error('No LLM endpoint')
      }
      await saveLlmEndpoints(cleaned)
      await saveLlmPrompts(draftPrompts)
      // 确保两个功能都有端点，缺失则默认用第一个
      if (
        !optimizeEndpointId ||
        !cleaned.find((e) => e.id === optimizeEndpointId)
      ) {
        setOptimizeEndpointId(cleaned[0].id)
      }
      if (
        !charCardEndpointId ||
        !cleaned.find((e) => e.id === charCardEndpointId)
      ) {
        setCharCardEndpointId(cleaned[0].id)
      }
      message.success('LLM 配置保存成功')
    },
  }))

  return (
    <div className="px-4 py-2">
      <Form layout="vertical">
        {/* —— LLM 端点列表管理 —— */}
        <div className="mb-2 text-sm text-gray-500">LLM 端点（提示词优化 / 角色卡生成）</div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={activeEndpoint?.id}
            onChange={setActiveId}
            className="min-w-[120px] flex-1"
            options={draftEndpoints.map((e) => ({
              value: e.id,
              label: e.name || '未命名端点',
            }))}
          />
          <Button icon={<PlusOutlined />} onClick={handleAddEndpoint}>
            新增
          </Button>
          {draftEndpoints.length > 1 && (
            <Button
              danger
              onClick={() => handleDeleteEndpoint(activeEndpoint.id)}
            >
              删除
            </Button>
          )}
        </div>

        {activeEndpoint && (
          <div className="mt-3 space-y-3 rounded border border-slate-100 p-3">
            <Form.Item label="名称" required>
              <Input
                value={activeEndpoint.name}
                onChange={(e) => updateActiveEndpoint({ name: e.target.value })}
                placeholder="如 OpenRouter Gemini、GPT-5"
              />
            </Form.Item>
            <Form.Item label="API 地址 (baseURL)" required>
              <Input
                value={activeEndpoint.baseURL}
                onChange={(e) =>
                  updateActiveEndpoint({ baseURL: e.target.value })
                }
                placeholder="如 https://openrouter.ai/api/v1"
              />
            </Form.Item>
            <Form.Item label="模型 ID" required>
              <Input
                value={activeEndpoint.model}
                onChange={(e) => updateActiveEndpoint({ model: e.target.value })}
                placeholder="如 google/gemini-3-pro"
              />
            </Form.Item>
            <Form.Item label="API Key" required>
              <Input.Password
                value={activeEndpoint.apiKey}
                onChange={(e) =>
                  updateActiveEndpoint({ apiKey: e.target.value })
                }
                placeholder="输入该端点的 API Key"
              />
            </Form.Item>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="small"
                type={
                  optimizeEndpointId === activeEndpoint.id
                    ? 'primary'
                    : 'default'
                }
                onClick={() => setOptimizeEndpointId(activeEndpoint.id)}
              >
                {optimizeEndpointId === activeEndpoint.id
                  ? '当前提示词优化端点'
                  : '设为提示词优化端点'}
              </Button>
              <Button
                size="small"
                type={
                  charCardEndpointId === activeEndpoint.id
                    ? 'primary'
                    : 'default'
                }
                onClick={() => setCharCardEndpointId(activeEndpoint.id)}
              >
                {charCardEndpointId === activeEndpoint.id
                  ? '当前角色卡生成端点'
                  : '设为角色卡生成端点'}
              </Button>
            </div>
          </div>
        )}

        <div className="my-3 border-t border-slate-100" />

        {/* —— 系统提示词 —— */}
        <div className="mb-2 text-sm text-gray-500">系统提示词</div>
        <Form.Item label="提示词优化提示词">
          <Input.TextArea
            value={draftPrompts.optimizePrompt}
            onChange={(e) =>
              setDraftPrompts((p) => ({ ...p, optimizePrompt: e.target.value }))
            }
            autoSize={{ minRows: 6, maxRows: 20 }}
            style={{ resize: 'none' }}
          />
        </Form.Item>
        <Form.Item label="角色卡生成提示词">
          <Input.TextArea
            value={draftPrompts.charCardPrompt}
            onChange={(e) =>
              setDraftPrompts((p) => ({ ...p, charCardPrompt: e.target.value }))
            }
            autoSize={{ minRows: 6, maxRows: 20 }}
            style={{ resize: 'none' }}
          />
        </Form.Item>
        <Form.Item label="风格优化系统提示词" extra="与提示词优化共用同一个 LLM 端点。">
          <Input.TextArea
            value={draftPrompts.styleOptimizePrompt}
            onChange={(e) =>
              setDraftPrompts((p) => ({
                ...p,
                styleOptimizePrompt: e.target.value,
              }))
            }
            autoSize={{ minRows: 6, maxRows: 20 }}
            style={{ resize: 'none' }}
          />
        </Form.Item>
      </Form>
    </div>
  )
})
