import { PlusOutlined } from '@ant-design/icons'
import { Button, Form, Input, message, Select } from 'antd'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { LlmEndpoint, LlmPrompts } from '../../../../server/common/config'
import { resolveLlmEndpointId } from '../../../hooks/useEnabledLlmEndpoints'
import { useEndpointModels } from '../../../hooks/useEndpointModels'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { t, useAppLanguage } from '../../../i18n'
import { canonicalizeLlmPrompts, localizeLlmPrompt } from '../../../prompts/localize'
import { useGlobalStore } from '../../../store/global'
import {
  findLlmEndpointPreset,
  LLM_ENDPOINT_PRESETS,
  type LlmEndpointPreset,
} from './llmEndpointPresets'
import { ModelIdInput } from './ModelIdInput'

export interface LlmSettingRef {
  save: () => Promise<void>
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'openai/gpt-5.6-luna'
const VENICE_BASE_URL = 'https://api.venice.ai/api/v1'

const createEmptyEndpoint = (): LlmEndpoint => ({
  id: uuidv4(),
  name: '',
  baseURL: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
  apiKey: '',
})

const createPresetEndpoint = (preset: LlmEndpointPreset): LlmEndpoint => ({
  id: uuidv4(),
  name: preset.name,
  baseURL: preset.baseURL,
  model: preset.model,
  apiKey: '',
})

const cleanEndpoint = (endpoint: LlmEndpoint): LlmEndpoint => ({
  ...endpoint,
  name: endpoint.name.trim(),
  baseURL: endpoint.baseURL.trim(),
  model: endpoint.model.trim(),
})

const isCompleteEndpoint = (endpoint: LlmEndpoint) =>
  Boolean(
    endpoint.name && endpoint.baseURL && endpoint.model && endpoint.apiKey,
  )

export const LlmSetting = forwardRef<LlmSettingRef>((_props, ref) => {
  const { language } = useAppLanguage()

  const { llmEndpoints, llmPrompts, defaultLlmPrompts, saveLlmEndpoints, saveLlmPrompts } =
    useGlobalStore()
  const {
    optimizeEndpointId,
    setOptimizeEndpointId,
    charCardEndpointId,
    setCharCardEndpointId,
    styleExtractEndpointId,
    setStyleExtractEndpointId,
  } = useLocalSetting()

  const updateSelectedEndpoints = (endpoints: LlmEndpoint[]) => {
    setOptimizeEndpointId(resolveLlmEndpointId(endpoints, optimizeEndpointId))
    setCharCardEndpointId(resolveLlmEndpointId(endpoints, charCardEndpointId))
    setStyleExtractEndpointId(
      resolveLlmEndpointId(endpoints, styleExtractEndpointId),
    )
  }

  // 本地编辑态
  const [draftEndpoints, setDraftEndpoints] = useState<LlmEndpoint[]>(
    llmEndpoints.length ? llmEndpoints : [createEmptyEndpoint()],
  )
  const [activeId, setActiveId] = useState<string>(draftEndpoints[0]?.id || '')
  const [pendingPresetEndpoint, setPendingPresetEndpoint] =
    useState<LlmEndpoint | null>(null)
  const [draftPrompts, setDraftPrompts] = useState<LlmPrompts>(llmPrompts)
  const shownPrompt = (key: keyof LlmPrompts) =>
    localizeLlmPrompt(key, draftPrompts[key], defaultLlmPrompts, language)
  const [updatingEndpoint, setUpdatingEndpoint] = useState(false)
  const skipNextEndpointSyncRef = useRef(false)

  // 配置变化时同步草稿
  useEffect(() => {
    if (skipNextEndpointSyncRef.current) {
      skipNextEndpointSyncRef.current = false
      return
    }
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
    pendingPresetEndpoint ||
    draftEndpoints.find((e) => e.id === activeId) ||
    draftEndpoints[0]
  const activePreset = findLlmEndpointPreset(activeEndpoint)
  const isVeniceEndpoint =
    activeEndpoint?.baseURL.trim().replace(/\/+$/, '') === VENICE_BASE_URL
  const {
    models: textModels,
    loading: loadingTextModels,
    error: textModelsError,
    refresh: refreshTextModels,
  } = useEndpointModels({
    catalog: isVeniceEndpoint ? 'venice-vision-text' : 'openai-vision-text',
    baseURL: activeEndpoint?.baseURL,
    apiKey: activeEndpoint?.apiKey,
    enabled: Boolean(activeEndpoint),
  })

  const updateActiveEndpoint = (patch: Partial<LlmEndpoint>) => {
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
    const preset = LLM_ENDPOINT_PRESETS.find((item) => item.id === presetId)
    if (!preset) return

    setPendingPresetEndpoint(createPresetEndpoint(preset))
    message.info(
      t('已载入“{0}”预设，请填写 API Key 后更新或保存', [preset.label]),
    )
  }

  const handleDeleteEndpoint = (id: string) => {
    setDraftEndpoints((list) => {
      const next = list.filter((e) => e.id !== id)
      if (next.length === 0) {
        const fresh = createEmptyEndpoint()
        setActiveId(fresh.id)
        updateSelectedEndpoints([])
        return [fresh]
      }
      if (id === activeId) {
        setActiveId(next[0].id)
      }
      updateSelectedEndpoints(next)
      return next
    })
  }

  const handleToggleEndpoint = async () => {
    if (!activeEndpoint) return
    const { id } = activeEndpoint
    const disabled = !activeEndpoint.disabled
    const savedEndpoint = llmEndpoints.find((endpoint) => endpoint.id === id)

    // 已保存的端点只更新停用状态，保留各端点尚未保存的编辑内容。
    if (savedEndpoint) {
      setUpdatingEndpoint(true)
      skipNextEndpointSyncRef.current = true
      try {
        const next = llmEndpoints.map((endpoint) =>
          endpoint.id === id ? { ...endpoint, disabled } : endpoint,
        )
        if (!(await saveLlmEndpoints(next))) {
          skipNextEndpointSyncRef.current = false
          message.error(t('端点状态更新失败'))
          return
        }
        updateSelectedEndpoints(next)
      } finally {
        setUpdatingEndpoint(false)
      }
    }
    updateActiveEndpoint({ disabled })
    message.success(disabled ? t('端点已停用') : t('端点已启用'))
  }

  const handleUpdateEndpoint = async () => {
    if (!activeEndpoint) return

    const cleanedEndpoint = cleanEndpoint(activeEndpoint)
    if (!isCompleteEndpoint(cleanedEndpoint)) {
      message.warning(t('请完整配置当前 LLM 端点（名称/地址/模型/Key）'))
      return
    }

    const nextEndpoints = llmEndpoints.some(
      (endpoint) => endpoint.id === cleanedEndpoint.id,
    )
      ? llmEndpoints.map((endpoint) =>
          endpoint.id === cleanedEndpoint.id ? cleanedEndpoint : endpoint,
        )
      : [...llmEndpoints, cleanedEndpoint]

    setUpdatingEndpoint(true)
    skipNextEndpointSyncRef.current = true
    try {
      const saved = await saveLlmEndpoints(nextEndpoints)
      if (!saved) {
        skipNextEndpointSyncRef.current = false
        message.error(t('当前 LLM 端点更新失败'))
        return
      }
      setDraftEndpoints((list) =>
        list.some((endpoint) => endpoint.id === cleanedEndpoint.id)
          ? list.map((endpoint) =>
              endpoint.id === cleanedEndpoint.id ? cleanedEndpoint : endpoint,
            )
          : [...list, cleanedEndpoint],
      )
      setPendingPresetEndpoint(null)
      setActiveId(cleanedEndpoint.id)
      updateSelectedEndpoints(nextEndpoints)
      message.success(t('当前 LLM 端点已更新'))
    } finally {
      setUpdatingEndpoint(false)
    }
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      const endpointsToSave = pendingPresetEndpoint
        ? [...draftEndpoints, pendingPresetEndpoint]
        : draftEndpoints
      const cleaned = endpointsToSave
        .map(cleanEndpoint)
        .filter(isCompleteEndpoint)
      if (cleaned.length === 0) {
        message.warning(t('请至少完整配置一个 LLM 端点（名称/地址/模型/Key）'))
        throw new Error('No LLM endpoint')
      }
      const saved = await saveLlmEndpoints(cleaned)
      if (!saved) {
        message.error(t('LLM 端点配置保存失败'))
        throw new Error('Failed to save LLM endpoints')
      }
      setDraftEndpoints(cleaned)
      if (pendingPresetEndpoint && isCompleteEndpoint(pendingPresetEndpoint)) {
        setActiveId(pendingPresetEndpoint.id)
      }
      setPendingPresetEndpoint(null)
      await saveLlmPrompts(canonicalizeLlmPrompts(draftPrompts, defaultLlmPrompts))
      updateSelectedEndpoints(cleaned)
      message.success(t('LLM 配置保存成功'))
    },
  }))

  return (
    <div className="px-4 py-2">
      <Form layout="vertical">
        {/* —— LLM 端点列表管理 —— */}
        <div className="mb-2 text-sm text-slate-400">
          {t('LLM 端点（提示词优化 / 角色卡生成）')}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={pendingPresetEndpoint ? undefined : activeEndpoint?.id}
            placeholder={
              pendingPresetEndpoint
                ? t('预设草稿：{0}', [pendingPresetEndpoint.name])
                : t('选择端点')
            }
            onChange={handleSelectEndpoint}
            className="min-w-[120px] flex-1"
            options={draftEndpoints.map((e) => ({
              value: e.id,
              label: `${e.name || t('未命名端点')}${e.disabled ? ` (${t('已停用')})` : ''}`,
            }))}
          />
          <Button icon={<PlusOutlined />} onClick={handleAddEndpoint}>
            {t('新增')}
          </Button>
          <Select
            value={undefined}
            placeholder={t('从预设新增')}
            className="min-w-44"
            onChange={handleAddPresetEndpoint}
            options={LLM_ENDPOINT_PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.label,
            }))}
          />
          <Button loading={updatingEndpoint} onClick={handleUpdateEndpoint}>
            {t('更新')}
          </Button>
          <Button
            disabled={updatingEndpoint || !activeEndpoint}
            onClick={handleToggleEndpoint}
          >
            {activeEndpoint?.disabled ? t('启用') : t('停用')}
          </Button>
          {!pendingPresetEndpoint && draftEndpoints.length > 1 && (
            <Button
              danger
              onClick={() => handleDeleteEndpoint(activeEndpoint.id)}
            >
              {t('删除')}
            </Button>
          )}
        </div>

        {activeEndpoint && (
          <div className="mt-3 space-y-3 rounded-lg border border-[#343a44] bg-[#181c22] p-3">
            {activePreset && (
              <div className="endpoint-preset-note rounded-md border px-3 py-2 text-xs leading-5">
                <div className="endpoint-preset-note-title font-medium">
                  {activePreset.label}
                </div>
                <div>
                  {t('官网：')}{' '}
                  <a
                    href={activePreset.website}
                    target="_blank"
                    rel="noreferrer"
                    className="endpoint-preset-note-link"
                  >
                    {activePreset.website}
                  </a>
                </div>
                {activePreset.notes.map((note) => (
                  <div key={note} className="endpoint-preset-note-muted">
                    {note}
                  </div>
                ))}
              </div>
            )}
            <Form.Item label={t('名称')} required>
              <Input
                value={activeEndpoint.name}
                onChange={(e) => updateActiveEndpoint({ name: e.target.value })}
                placeholder={t('如 OpenRouter Gemini、GPT-5')}
              />
            </Form.Item>
            <Form.Item label={t('API 地址 (baseURL)')} required>
              <Input
                value={activeEndpoint.baseURL}
                onChange={(e) =>
                  updateActiveEndpoint({ baseURL: e.target.value })
                }
                placeholder={t('如 https://openrouter.ai/api/v1')}
              />
            </Form.Item>
            <Form.Item label={t('模型 ID')} required>
              <ModelIdInput
                value={activeEndpoint.model}
                onChange={(model) => updateActiveEndpoint({ model })}
                models={textModels}
                loading={loadingTextModels}
                error={textModelsError}
                onRefresh={refreshTextModels}
                directoryLabel={
                  isVeniceEndpoint
                    ? t('Venice 视觉文本模型目录')
                    : t('视觉文本模型目录')
                }
                waitingForKey={!activeEndpoint.apiKey.trim()}
                placeholder={
                  isVeniceEndpoint
                    ? t('搜索或输入 Venice 文本模型 ID')
                    : t('搜索或输入模型 ID，如 openai/gpt-5.6-luna')
                }
              />
              <div className="mt-1 text-xs text-slate-500">
                {t(
                  '候选列表优先显示同时支持文本、图片输入并输出文本的模型；无能力元数据的自定义模型仍可手动输入。',
                )}
              </div>
            </Form.Item>
            <Form.Item label="API Key" required>
              <Input.Password
                value={activeEndpoint.apiKey}
                onChange={(e) =>
                  updateActiveEndpoint({ apiKey: e.target.value })
                }
                placeholder={t('输入该端点的 API Key')}
              />
            </Form.Item>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="small"
                disabled={
                  Boolean(pendingPresetEndpoint) || activeEndpoint.disabled
                }
                type={
                  optimizeEndpointId === activeEndpoint.id
                    ? 'primary'
                    : 'default'
                }
                onClick={() => setOptimizeEndpointId(activeEndpoint.id)}
              >
                {optimizeEndpointId === activeEndpoint.id
                  ? t('当前提示词优化端点')
                  : t('设为提示词优化端点')}
              </Button>
              <Button
                size="small"
                disabled={
                  Boolean(pendingPresetEndpoint) || activeEndpoint.disabled
                }
                type={
                  charCardEndpointId === activeEndpoint.id
                    ? 'primary'
                    : 'default'
                }
                onClick={() => setCharCardEndpointId(activeEndpoint.id)}
              >
                {charCardEndpointId === activeEndpoint.id
                  ? t('当前角色卡生成端点')
                  : t('设为角色卡生成端点')}
              </Button>
            </div>
          </div>
        )}

        <div className="my-3 border-t border-[#343a44]" />

        {/* —— 系统提示词 —— */}
        <div className="mb-2 text-sm text-slate-400">{t('系统提示词')}</div>
        <Form.Item label={t('提示词优化提示词')}>
          <Input.TextArea
            value={shownPrompt('optimizePrompt')}
            onChange={(e) =>
              setDraftPrompts((p) => ({ ...p, optimizePrompt: e.target.value }))
            }
            autoSize={{ minRows: 6, maxRows: 20 }}
            style={{ resize: 'none' }}
          />
        </Form.Item>
        <Form.Item label={t('NovelAI Furry 文生图/图生图提示词优化')}>
          <Input.TextArea
            value={shownPrompt('novelaiFurryPrompt')}
            onChange={(e) =>
              setDraftPrompts((p) => ({
                ...p,
                novelaiFurryPrompt: e.target.value,
              }))
            }
            autoSize={{ minRows: 6, maxRows: 20 }}
          />
        </Form.Item>
        <Form.Item label={t('NovelAI Anime 文生图/图生图提示词优化')}>
          <Input.TextArea
            value={shownPrompt('novelaiAnimePrompt')}
            onChange={(e) =>
              setDraftPrompts((p) => ({
                ...p,
                novelaiAnimePrompt: e.target.value,
              }))
            }
            autoSize={{ minRows: 6, maxRows: 20 }}
          />
        </Form.Item>
        <Form.Item label={t('NovelAI Furry 局部重绘提示词优化')}>
          <Input.TextArea
            value={shownPrompt('novelaiInpaintFurryPrompt')}
            onChange={(e) =>
              setDraftPrompts((p) => ({
                ...p,
                novelaiInpaintFurryPrompt: e.target.value,
              }))
            }
            autoSize={{ minRows: 6, maxRows: 20 }}
          />
        </Form.Item>
        <Form.Item label={t('NovelAI Anime 局部重绘提示词优化')}>
          <Input.TextArea
            value={shownPrompt('novelaiInpaintAnimePrompt')}
            onChange={(e) =>
              setDraftPrompts((p) => ({
                ...p,
                novelaiInpaintAnimePrompt: e.target.value,
              }))
            }
            autoSize={{ minRows: 6, maxRows: 20 }}
          />
        </Form.Item>
        <Form.Item label={t('角色卡生成提示词')}>
          <Input.TextArea
            value={shownPrompt('charCardPrompt')}
            onChange={(e) =>
              setDraftPrompts((p) => ({ ...p, charCardPrompt: e.target.value }))
            }
            autoSize={{ minRows: 6, maxRows: 20 }}
            style={{ resize: 'none' }}
          />
        </Form.Item>
        <Form.Item
          label={t('风格优化系统提示词')}
          extra={t('与提示词优化共用同一个 LLM 端点。')}
        >
          <Input.TextArea
            value={shownPrompt('styleOptimizePrompt')}
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
