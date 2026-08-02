import { ExclamationCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Form, Input, message, Radio, Select, Switch } from 'antd'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { GptImageEndpoint } from '../../../../server/common/config'
import { useGPTImageQuota } from '../../../hooks/useGPTImageQuota'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../store/global'
import {
  findGptImageEndpointPreset,
  GPT_IMAGE_ENDPOINT_PRESETS,
  type GptImageEndpointPreset,
} from './gptImageEndpointPresets'

export interface GPTImageSettingRef {
  save: () => Promise<string | undefined>
}

const DEFAULT_YUNWU_BASE_URL = 'https://api.wlai.vip/v1'
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.1-flash-image'
const DEFAULT_CHAT_MODEL = 'google/gemini-2.5-flash-image'
const DEFAULT_BALANCE_API_PATH = '/credits'
const DEFAULT_BALANCE_RESULT_JSON_KEY = 'data.total_usage'

const createEmptyEndpoint = (): GptImageEndpoint => ({
  id: uuidv4(),
  name: '',
  baseURL: DEFAULT_YUNWU_BASE_URL,
  model: DEFAULT_MODEL,
  apiKey: '',
  type: 'yunwu',
  engine: 'openai-images',
})

const createPresetEndpoint = (
  preset: GptImageEndpointPreset,
): GptImageEndpoint => ({
  id: uuidv4(),
  name: preset.name,
  baseURL: preset.baseURL,
  model: preset.model,
  apiKey: '',
  type: preset.type,
  engine: preset.engine,
  balanceEnabled: preset.balanceEnabled,
  balanceApiPath: preset.balanceApiPath,
  balanceResultJsonKey: preset.balanceResultJsonKey,
})

const cleanEndpoint = (endpoint: GptImageEndpoint): GptImageEndpoint => {
  const cleaned = {
    ...endpoint,
    name: endpoint.name.trim(),
  }

  if (cleaned.type === 'custom' && cleaned.balanceEnabled) {
    cleaned.balanceApiPath =
      cleaned.balanceApiPath?.trim() || DEFAULT_BALANCE_API_PATH
    cleaned.balanceResultJsonKey =
      cleaned.balanceResultJsonKey?.trim() || DEFAULT_BALANCE_RESULT_JSON_KEY
  }

  return cleaned
}

const isCompleteEndpoint = (endpoint: GptImageEndpoint) =>
  Boolean(
    endpoint.name && endpoint.baseURL && endpoint.model && endpoint.apiKey,
  )

export const GPTImageSetting = forwardRef<GPTImageSettingRef>((_props, ref) => {
  const [form] = Form.useForm()
  const { endpoints, saveEndpoints } = useGlobalStore()
  const { gptImageSettings, setGptImageSettings } = useLocalSetting()
  const { isPublic } = useGPTImageQuota()
  const [updatingEndpoint, setUpdatingEndpoint] = useState(false)
  const skipNextEndpointSyncRef = useRef(false)

  // 本地编辑态：脱离表单直接管理整个端点列表，保存时整体提交
  const [draftEndpoints, setDraftEndpoints] = useState<GptImageEndpoint[]>(
    endpoints.length ? endpoints : [createEmptyEndpoint()],
  )
  const [activeId, setActiveId] = useState<string>(draftEndpoints[0]?.id || '')
  const [pendingPresetEndpoint, setPendingPresetEndpoint] =
    useState<GptImageEndpoint | null>(null)

  // 配置变化时同步草稿（如首次加载）
  useEffect(() => {
    if (skipNextEndpointSyncRef.current) {
      skipNextEndpointSyncRef.current = false
      return
    }
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
    pendingPresetEndpoint ||
    draftEndpoints.find((e) => e.id === activeId) ||
    draftEndpoints[0]
  const activePreset = findGptImageEndpointPreset(activeEndpoint)

  const updateActiveEndpoint = (patch: Partial<GptImageEndpoint>) => {
    if (pendingPresetEndpoint) {
      setPendingPresetEndpoint((endpoint) =>
        endpoint ? { ...endpoint, ...patch } : endpoint,
      )
      return
    }
    setDraftEndpoints((list) =>
      list.map((e) => (e.id === activeEndpoint.id ? { ...e, ...patch } : e)),
    )
  }

  const handleSelectEndpoint = (id: string) => {
    setPendingPresetEndpoint(null)
    setActiveId(id)
  }

  const handleAddEndpoint = () => {
    const ep = createEmptyEndpoint()
    setPendingPresetEndpoint(null)
    setDraftEndpoints((list) => [...list, ep])
    setActiveId(ep.id)
  }

  const handleAddPresetEndpoint = (presetId: string) => {
    const preset = GPT_IMAGE_ENDPOINT_PRESETS.find(
      (item) => item.id === presetId,
    )
    if (!preset) return

    const endpoint = createPresetEndpoint(preset)
    setPendingPresetEndpoint(endpoint)
    message.info(`已载入“${preset.label}”预设，请填写 API Key 后更新或保存`)
  }

  const handleDeleteEndpoint = (id: string) => {
    setDraftEndpoints((list) => {
      const next = list.filter((e) => e.id !== id)
      if (next.length === 0) {
        const fresh = createEmptyEndpoint()
        setActiveId(fresh.id)
        setGptImageSettings((prev) => ({
          ...prev,
          defaultEndpointId: undefined,
        }))
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

  const handleUpdateEndpoint = async () => {
    if (!activeEndpoint) return

    const cleanedEndpoint = cleanEndpoint(activeEndpoint)
    if (!isCompleteEndpoint(cleanedEndpoint)) {
      message.warning('请完整配置当前端点（名称/地址/模型/Key）')
      return
    }

    const nextEndpoints = endpoints.some((e) => e.id === cleanedEndpoint.id)
      ? endpoints.map((e) =>
          e.id === cleanedEndpoint.id ? cleanedEndpoint : e,
        )
      : [...endpoints, cleanedEndpoint]

    setUpdatingEndpoint(true)
    skipNextEndpointSyncRef.current = true
    try {
      const saved = await saveEndpoints(nextEndpoints)
      if (!saved) {
        skipNextEndpointSyncRef.current = false
        message.error('当前端点更新失败')
        return
      }
      setDraftEndpoints((list) =>
        list.some((e) => e.id === cleanedEndpoint.id)
          ? list.map((e) => (e.id === cleanedEndpoint.id ? cleanedEndpoint : e))
          : [...list, cleanedEndpoint],
      )
      setPendingPresetEndpoint(null)
      setActiveId(cleanedEndpoint.id)
      message.success('当前端点已更新')
    } finally {
      setUpdatingEndpoint(false)
    }
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      // 校验端点
      const endpointsToSave = pendingPresetEndpoint
        ? [...draftEndpoints, pendingPresetEndpoint]
        : draftEndpoints
      const cleaned = endpointsToSave
        .map(cleanEndpoint)
        .filter(isCompleteEndpoint)
      if (cleaned.length === 0) {
        message.warning('请至少完整配置一个端点（名称/地址/模型/Key）')
        throw new Error('No endpoint')
      }
      const saved = await saveEndpoints(cleaned)
      if (!saved) {
        message.error('端点配置保存失败')
        throw new Error('Failed to save endpoints')
      }
      setDraftEndpoints(cleaned)
      if (pendingPresetEndpoint && isCompleteEndpoint(pendingPresetEndpoint)) {
        setActiveId(pendingPresetEndpoint.id)
      }
      setPendingPresetEndpoint(null)

      const values = await form.validateFields()
      setGptImageSettings((prev) => {
        const defaultEndpointId = cleaned.some(
          (e) => e.id === prev.defaultEndpointId,
        )
          ? prev.defaultEndpointId
          : cleaned[0].id
        const selectedEndpointId = cleaned.some(
          (e) => e.id === prev.selectedEndpointId,
        )
          ? prev.selectedEndpointId
          : defaultEndpointId

        return {
          ...prev,
          enable1K: values.enable1K ?? prev.enable1K,
          enable2K: values.enable2K ?? prev.enable2K,
          enable4K: values.enable4K ?? prev.enable4K,
          quality: values.quality ?? prev.quality,
          enableMultiple: isPublic
            ? false
            : (values.enableMultiple ?? prev.enableMultiple),
          defaultEndpointId,
          selectedEndpointId,
        }
      })
      message.success('配置保存成功')
      return cleaned[0]?.apiKey
    },
  }))

  return (
    <div className="px-4 py-2">
      <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 shadow-[inset_3px_0_0_rgba(228,173,58,0.75)]">
        <ExclamationCircleOutlined className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-amber-200">
            警惕第三方中转站风险
          </div>
          <div className="mt-1 text-xs leading-5 text-amber-100/75">
            请勿填写真实密码等无关敏感信息；充值前请核实平台口碑与运营方，建议小额试用、随用随充。预设仅用于填写公开参数，不代表对服务商的背书。
          </div>
        </div>
      </div>
      <Form form={form} layout="vertical">
        {/* —— 端点列表管理 —— */}
        <div className="mb-2 text-sm text-slate-400">图片生成端点</div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={pendingPresetEndpoint ? undefined : activeEndpoint?.id}
            placeholder={
              pendingPresetEndpoint
                ? `预设草稿：${pendingPresetEndpoint.name}`
                : '选择端点'
            }
            onChange={handleSelectEndpoint}
            className="min-w-40 flex-1"
            options={draftEndpoints.map((e) => ({
              value: e.id,
              label: e.name || '未命名端点',
            }))}
          />
          <Button icon={<PlusOutlined />} onClick={handleAddEndpoint}>
            新增
          </Button>
          <Select
            value={undefined}
            placeholder="从预设新增"
            className="min-w-44"
            onChange={handleAddPresetEndpoint}
            options={GPT_IMAGE_ENDPOINT_PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.label,
            }))}
          />
          <Button loading={updatingEndpoint} onClick={handleUpdateEndpoint}>
            更新
          </Button>
          {!pendingPresetEndpoint && draftEndpoints.length > 1 && (
            <Button
              danger
              onClick={() => handleDeleteEndpoint(activeEndpoint.id)}
            >
              删除
            </Button>
          )}
        </div>

        {activeEndpoint && (
          <div className="mt-3 space-y-3 rounded-lg border border-[#343a44] bg-[#181c22] p-3">
            {activePreset && (
              <div className="rounded-md border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-xs leading-5 text-sky-100 shadow-[inset_3px_0_0_rgba(56,189,248,0.55)]">
                <div className="font-medium text-sky-200">
                  {activePreset.label}
                </div>
                <div>
                  官网：{' '}
                  <a
                    href={activePreset.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 hover:text-sky-200!"
                  >
                    {activePreset.website}
                  </a>
                </div>
                {activePreset.notes.map((note) => (
                  <div key={note} className="text-sky-100/70">
                    {note}
                  </div>
                ))}
              </div>
            )}
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
                  activeEndpoint.engine === 'chat-completions' ||
                  activeEndpoint.engine === 'openrouter-images'
                    ? '如 https://openrouter.ai/api/v1'
                    : '如 https://api.wlai.vip/v1'
                }
              />
            </Form.Item>
            <Form.Item label="模型 ID" required>
              <Input
                value={activeEndpoint.model}
                onChange={(e) =>
                  updateActiveEndpoint({ model: e.target.value })
                }
                placeholder={
                  activeEndpoint.engine === 'chat-completions'
                    ? '如 google/gemini-2.5-flash-image'
                    : activeEndpoint.engine === 'openrouter-images'
                      ? '如 google/gemini-3.1-flash-image'
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
                    ...(engine === 'openrouter-images' &&
                    [DEFAULT_MODEL, DEFAULT_CHAT_MODEL].includes(
                      activeEndpoint.model,
                    )
                      ? { model: DEFAULT_OPENROUTER_MODEL }
                      : {}),
                    ...(engine === 'openai-images' &&
                    [DEFAULT_CHAT_MODEL, DEFAULT_OPENROUTER_MODEL].includes(
                      activeEndpoint.model,
                    )
                      ? { model: DEFAULT_MODEL }
                      : {}),
                    ...((engine === 'openrouter-images' ||
                      engine === 'chat-completions') &&
                    activeEndpoint.baseURL === DEFAULT_YUNWU_BASE_URL
                      ? {
                          baseURL: DEFAULT_OPENROUTER_BASE_URL,
                          type: 'openrouter' as const,
                        }
                      : {}),
                    ...(engine === 'openai-images' &&
                    activeEndpoint.baseURL === DEFAULT_OPENROUTER_BASE_URL
                      ? { baseURL: DEFAULT_YUNWU_BASE_URL }
                      : {}),
                  })
                }}
              >
                <Radio.Button value="openai-images">
                  GPT Image / DALL·E
                </Radio.Button>
                <Radio.Button value="openrouter-images">
                  OpenRouter Images
                </Radio.Button>
                <Radio.Button value="chat-completions">
                  聊天式（Nano Banana 等）
                </Radio.Button>
              </Radio.Group>
              <div className="mt-1 text-xs text-slate-500">
                GPT Image / DALL·E 使用 OpenAI 兼容接口；OpenRouter Images
                使用专用 /images 接口并按模型能力传参；聊天式使用
                chat/completions，并通过 image_config 传递图片参数。
              </div>
            </Form.Item>
            <Form.Item label="端点类型" required>
              <Radio.Group
                value={activeEndpoint.type}
                onChange={(e) => {
                  const type = e.target.value as GptImageEndpoint['type']
                  updateActiveEndpoint({
                    type,
                    ...(type === 'custom'
                      ? {
                          balanceApiPath:
                            activeEndpoint.balanceApiPath ||
                            DEFAULT_BALANCE_API_PATH,
                          balanceResultJsonKey:
                            activeEndpoint.balanceResultJsonKey ||
                            DEFAULT_BALANCE_RESULT_JSON_KEY,
                        }
                      : {}),
                  })
                }}
              >
                <Radio.Button value="yunwu">New API（云雾）</Radio.Button>
                <Radio.Button value="openrouter">OpenRouter</Radio.Button>
                <Radio.Button value="custom">自定义</Radio.Button>
              </Radio.Group>
              <div className="mt-1 text-xs text-slate-500">
                New API（云雾）/ OpenRouter
                类型端点会在右上角显示余额；自定义端点可按需开启余额查询。
              </div>
            </Form.Item>
            {activeEndpoint.type === 'custom' && (
              <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">
                      获取账户余额
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      使用当前 API Key 发起 GET 请求，并从响应 JSON 中读取余额。
                    </div>
                  </div>
                  <Switch
                    checked={activeEndpoint.balanceEnabled ?? false}
                    onChange={(balanceEnabled) =>
                      updateActiveEndpoint({
                        balanceEnabled,
                        balanceApiPath:
                          activeEndpoint.balanceApiPath ||
                          DEFAULT_BALANCE_API_PATH,
                        balanceResultJsonKey:
                          activeEndpoint.balanceResultJsonKey ||
                          DEFAULT_BALANCE_RESULT_JSON_KEY,
                      })
                    }
                  />
                </div>
                {activeEndpoint.balanceEnabled && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Form.Item label="余额API路径" className="mb-0" required>
                      <Input
                        value={
                          activeEndpoint.balanceApiPath ??
                          DEFAULT_BALANCE_API_PATH
                        }
                        onChange={(e) =>
                          updateActiveEndpoint({
                            balanceApiPath: e.target.value,
                          })
                        }
                        placeholder={DEFAULT_BALANCE_API_PATH}
                      />
                    </Form.Item>
                    <Form.Item label="结果JSON键" className="mb-0" required>
                      <Input
                        value={
                          activeEndpoint.balanceResultJsonKey ??
                          DEFAULT_BALANCE_RESULT_JSON_KEY
                        }
                        onChange={(e) =>
                          updateActiveEndpoint({
                            balanceResultJsonKey: e.target.value,
                          })
                        }
                        placeholder={DEFAULT_BALANCE_RESULT_JSON_KEY}
                      />
                    </Form.Item>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="small"
                disabled={Boolean(pendingPresetEndpoint)}
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
              <span className="text-xs text-slate-500">
                {pendingPresetEndpoint
                  ? '请先更新或保存预设端点，再设为默认端点'
                  : '刷新网页后图片生成会默认使用此端点'}
              </span>
            </div>
          </div>
        )}

        <div className="my-3 border-t border-white/10" />

        {/* —— 生成参数（与端点无关，本地设置） —— */}
        <Form.Item>
          <div className="mb-2 text-sm text-slate-400">生成尺寸</div>
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
          <div className="mb-2 text-sm text-slate-400">画质设置</div>
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
              <span className="text-sm text-slate-400">生成多张</span>
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
