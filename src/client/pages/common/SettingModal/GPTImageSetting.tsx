import { ExclamationCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Form, Input, Radio, Select, Switch, message } from 'antd'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { GptImageEndpoint } from '../../../../server/common/config'
import { useGPTImageQuota } from '../../../hooks/useGPTImageQuota'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../store/global'

export interface GPTImageSettingRef {
  save: () => Promise<string | undefined>
}

const DEFAULT_YUNWU_BASE_URL = 'https://api.wlai.vip/v1'
const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_CHAT_MODEL = 'google/gemini-2.5-flash-image-preview'

const createEmptyEndpoint = (): GptImageEndpoint => ({
  id: uuidv4(),
  name: '',
  baseURL: DEFAULT_YUNWU_BASE_URL,
  model: DEFAULT_MODEL,
  apiKey: '',
  type: 'yunwu',
  engine: 'openai-images',
})

export const GPTImageSetting = forwardRef<GPTImageSettingRef>((_props, ref) => {
  const [form] = Form.useForm()
  const { endpoints, saveEndpoints } = useGlobalStore()
  const { gptImageSettings, setGptImageSettings } = useLocalSetting()
  const { isPublic } = useGPTImageQuota()

  // 本地编辑态：脱离表单直接管理整个端点列表，保存时整体提交
  const [draftEndpoints, setDraftEndpoints] = useState<GptImageEndpoint[]>(
    endpoints.length ? endpoints : [createEmptyEndpoint()],
  )
  const [activeId, setActiveId] = useState<string>(draftEndpoints[0]?.id || '')

  // 配置变化时同步草稿（如首次加载）
  useEffect(() => {
    if (endpoints.length) {
      setDraftEndpoints(endpoints)
      if (!endpoints.find((e) => e.id === activeId)) {
        setActiveId(endpoints[0].id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoints])

  useEffect(() => {
    form.setFieldsValue({
      enable1K: gptImageSettings.enable1K,
      enable2K: gptImageSettings.enable2K,
      enable4K: gptImageSettings.enable4K,
      quality: gptImageSettings.quality,
      enableMultiple: isPublic ? false : gptImageSettings.enableMultiple,
    })
  }, [
    gptImageSettings.enable1K,
    gptImageSettings.enable2K,
    gptImageSettings.enable4K,
    gptImageSettings.quality,
    gptImageSettings.enableMultiple,
    isPublic,
    form,
  ])

  const activeEndpoint =
    draftEndpoints.find((e) => e.id === activeId) || draftEndpoints[0]

  const updateActiveEndpoint = (patch: Partial<GptImageEndpoint>) => {
    setDraftEndpoints((list) =>
      list.map((e) =>
        e.id === activeEndpoint.id ? { ...e, ...patch } : e,
      ),
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
        setGptImageSettings((prev) => ({ ...prev, defaultEndpointId: undefined }))
        return [fresh]
      }
      if (id === activeId) {
        setActiveId(next[0].id)
      }
      // 删除的是默认端点，则回退到第一个
      if (id === gptImageSettings.defaultEndpointId) {
        setGptImageSettings((prev) => ({
          ...prev,
          defaultEndpointId: next[0].id,
        }))
      }
      return next
    })
  }

  const handleSetDefaultEndpoint = (id: string) => {
    setGptImageSettings((prev) => ({ ...prev, defaultEndpointId: id }))
    message.success('已设为默认端点')
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      // 校验端点
      const cleaned = draftEndpoints
        .map((e) => ({ ...e, name: e.name.trim() }))
        .filter((e) => e.name && e.baseURL && e.model && e.apiKey)
      if (cleaned.length === 0) {
        message.warning('请至少完整配置一个端点（名称/地址/模型/Key）')
        throw new Error('No endpoint')
      }
      await saveEndpoints(cleaned)

      const values = await form.validateFields()
      setGptImageSettings({
        enable1K: values.enable1K ?? gptImageSettings.enable1K,
        enable2K: values.enable2K ?? gptImageSettings.enable2K,
        enable4K: values.enable4K ?? gptImageSettings.enable4K,
        quality: values.quality ?? gptImageSettings.quality,
        enableMultiple: isPublic
          ? false
          : (values.enableMultiple ?? gptImageSettings.enableMultiple),
      })
      message.success('配置保存成功')
      return cleaned[0]?.apiKey
    },
  }))

  return (
    <div className="px-4 py-2">
      <Form form={form} layout="vertical">
        {/* —— 端点列表管理 —— */}
        <div className="mb-2 text-sm text-gray-500">图片生成端点</div>
        <div className="flex gap-2">
          <Select
            value={activeEndpoint?.id}
            onChange={setActiveId}
            className="flex-1"
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
                placeholder="如 云雾(默认)、OpenAI 官方"
              />
            </Form.Item>
            <Form.Item label="API 地址 (baseURL)" required>
              <Input
                value={activeEndpoint.baseURL}
                onChange={(e) =>
                  updateActiveEndpoint({ baseURL: e.target.value })
                }
                placeholder={
                  activeEndpoint.engine === 'chat-completions'
                    ? '如 https://openrouter.ai/api/v1'
                    : '如 https://api.wlai.vip/v1'
                }
              />
            </Form.Item>
            <Form.Item label="模型 ID" required>
              <Input
                value={activeEndpoint.model}
                onChange={(e) => updateActiveEndpoint({ model: e.target.value })}
                placeholder={
                  activeEndpoint.engine === 'chat-completions'
                    ? '如 google/gemini-2.5-flash-image-preview'
                    : '如 gpt-image-2'
                }
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
            <Form.Item label="生成引擎" required>
              <Radio.Group
                value={activeEndpoint.engine || 'openai-images'}
                onChange={(e) => {
                  const engine = e.target.value
                  updateActiveEndpoint({
                    engine,
                    // 切换引擎时给出对应默认值，减少用户手动改的麻烦
                    ...(engine === 'chat-completions' &&
                    activeEndpoint.model === DEFAULT_MODEL
                      ? { model: DEFAULT_CHAT_MODEL }
                      : {}),
                    ...(engine === 'openai-images' &&
                    activeEndpoint.model === DEFAULT_CHAT_MODEL
                      ? { model: DEFAULT_MODEL }
                      : {}),
                  })
                }}
              >
                <Radio.Button value="openai-images">
                  GPT Image / DALL·E
                </Radio.Button>
                <Radio.Button value="chat-completions">
                  聊天式（Nano Banana 等）
                </Radio.Button>
              </Radio.Group>
              <div className="mt-1 text-xs text-gray-400">
                GPT Image / DALL·E 走 images 接口（支持 1K/2K/4K）；聊天式走
                chat/completions 接口（如 Nano Banana，不支持尺寸/画质）。
              </div>
            </Form.Item>
            <Form.Item label="端点类型" required>
              <Radio.Group
                value={activeEndpoint.type}
                onChange={(e) =>
                  updateActiveEndpoint({ type: e.target.value })
                }
              >
                <Radio.Button value="yunwu">云雾</Radio.Button>
                <Radio.Button value="openrouter">OpenRouter</Radio.Button>
                <Radio.Button value="custom">自定义</Radio.Button>
              </Radio.Group>
              <div className="mt-1 text-xs text-gray-400">
                云雾 / OpenRouter 类型端点会在右上角显示余额；自定义端点不显示余额。
              </div>
            </Form.Item>
            <div className="flex items-center gap-2">
              <Button
                size="small"
                type={
                  gptImageSettings.defaultEndpointId === activeEndpoint.id
                    ? 'primary'
                    : 'default'
                }
                onClick={() => handleSetDefaultEndpoint(activeEndpoint.id)}
              >
                {gptImageSettings.defaultEndpointId === activeEndpoint.id
                  ? '当前默认端点'
                  : '设为默认端点'}
              </Button>
              <span className="text-xs text-gray-400">
                刷新网页后图片生成会默认使用此端点
              </span>
            </div>
          </div>
        )}

        <div className="my-3 border-t border-slate-100" />

        {/* —— 生成参数（与端点无关，本地设置） —— */}
        <Form.Item>
          <div className="mb-2 text-sm text-gray-500">生成尺寸</div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg">
              <span>1K</span>
              <Form.Item name="enable1K" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>
            <div className="flex items-center gap-2">
              <span>2K</span>
              <Form.Item name="enable2K" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>
            <div className="flex items-center gap-2">
              <span>4K</span>
              <Form.Item name="enable4K" valuePropName="checked" noStyle>
                <Switch disabled={isPublic} />
              </Form.Item>
            </div>
          </div>
          <div className="mt-1 flex items-start gap-1 text-xs text-red-500">
            <ExclamationCircleOutlined className="mt-1" />
            <div>
              {isPublic ? (
                <div>公用 API Key 无法使用 4K 画质</div>
              ) : (
                <>
                  <div>开启 4K 后，Token 消耗是 2K 的 2~4 倍</div>
                  <div>单张图片可能产生 0.2 元以上的费用</div>
                  <div>图片将按比例缩放到总像素不超过 8294400</div>
                  <div>更容易失败或命中高倍率的分组</div>
                </>
              )}
            </div>
          </div>
        </Form.Item>
        <Form.Item>
          <div className="mb-2 text-sm text-gray-500">画质设置</div>
          <Form.Item name="quality" noStyle>
            <Radio.Group>
              <Radio.Button value="medium">Medium</Radio.Button>
              <Radio.Button value="high" disabled={isPublic}>
                High
              </Radio.Button>
            </Radio.Group>
          </Form.Item>
          <div className="mt-1 flex items-start gap-1 text-xs text-red-500">
            <ExclamationCircleOutlined className="mt-1" />
            <div>
              {isPublic ? (
                <div>公用 API Key 无法使用 High 画质</div>
              ) : (
                <>
                  <div>High 画质处理小字扭曲等细节效果更好 </div>
                  <div>
                    但 Token 消耗大约变为 4倍，整体性价比远不如提升画面尺寸
                  </div>
                  <div>更容易失败或命中高倍率的分组</div>
                </>
              )}
            </div>
          </div>
        </Form.Item>
        <Form.Item>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg">
              <span className="text-sm text-gray-500">生成多张</span>
              <Form.Item name="enableMultiple" valuePropName="checked" noStyle>
                <Switch disabled={isPublic} />
              </Form.Item>
            </div>
          </div>
          <div className="mt-1 flex items-start gap-1 text-xs text-red-500">
            <ExclamationCircleOutlined className="mt-1" />
            {isPublic ? (
              <div>公用 API Key 无法一次生成多张</div>
            ) : (
              <div>
                <div>生成多张与提交多次相同任务的效果和开销完全等价</div>
                <div>不会节省输入费用，不同张数之间也没有前后关联</div>
              </div>
            )}
          </div>
        </Form.Item>
      </Form>
    </div>
  )
})
