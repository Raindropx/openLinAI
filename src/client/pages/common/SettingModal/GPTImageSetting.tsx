import { ExclamationCircleOutlined, PlusOutlined } from '@ant-design/icons'
import {
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Radio,
  Select,
  Switch,
} from 'antd'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { GptImageEndpoint } from '../../../../server/common/config'
import { GEMINI_BASE_URL, GEMINI_IMAGE_MODEL } from '../../../../shared/gemini'
import {
  getLaoZhangImageFamily,
  LAOZHANG_BASE_URL,
  normalizeLaoZhangModel,
  usesLaoZhangImages,
} from '../../../../shared/laozhang'
import {
  SPICY_API_BASE_URL,
  SPICY_SEEDREAM_MODEL,
} from '../../../../shared/spicyapi'
import { resolveImageEndpointId } from '../../../hooks/useEnabledImageEndpoints'
import {
  type EndpointModelCatalog,
  useEndpointModels,
} from '../../../hooks/useEndpointModels'
import { useGPTImageQuota } from '../../../hooks/useGPTImageQuota'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { t, useAppLanguage } from '../../../i18n'
import { useGlobalStore } from '../../../store/global'
import { LoraWeightRow } from '../LoraWeightRow'
import {
  findGptImageEndpointPreset,
  GPT_IMAGE_ENDPOINT_PRESETS,
  type GptImageEndpointPreset,
} from './gptImageEndpointPresets'
import { ModelIdInput } from './ModelIdInput'
import { GeminiBalanceHelp, GeminiEndpointSettings } from './GeminiEndpointSettings'

export interface GPTImageSettingRef {
  save: () => Promise<string | undefined>
}

const DEFAULT_OPENAI_IMAGES_BASE_URL = 'https://api.openlux.ai/v1'
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_VENICE_BASE_URL = 'https://api.venice.ai/api/v1'
const DEFAULT_NOVELAI_BASE_URL = 'https://image.novelai.net'
const DEFAULT_NOVELAI_MODEL = 'nai-diffusion-5-full'
const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.1-flash-image'
const DEFAULT_CHAT_MODEL = 'google/gemini-2.5-flash-image'
const DEFAULT_BALANCE_API_PATH = '/credits'
const DEFAULT_BALANCE_RESULT_JSON_KEY = 'data.total_usage'

const createEmptyEndpoint = (): GptImageEndpoint => ({
  id: uuidv4(),
  name: '',
  baseURL: DEFAULT_OPENAI_IMAGES_BASE_URL,
  model: DEFAULT_MODEL,
  apiKey: '',
  type: 'custom',
  engine: 'openai-images',
})

const createPresetEndpoint = (
  preset: GptImageEndpointPreset,
): GptImageEndpoint => ({
  id: uuidv4(),
  name: preset.name,
  baseURL: preset.baseURL,
  model: preset.model,
  editModel: preset.editModel,
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
    baseURL: endpoint.baseURL.trim(),
    model: endpoint.model.trim(),
    editModel: endpoint.editModel?.trim() || undefined,
    spicyLoras: endpoint.spicyLoras?.map((lora) => ({
      ...lora,
      path: lora.path.trim(),
    })),
  }
  // An untouched/emptied replacement field keeps the saved credential.
  // The explicit Clear action sets the configured flag to false and sends ''.
  if (
    cleaned.balanceAccessTokenConfigured &&
    !cleaned.balanceAccessToken?.trim()
  ) {
    delete cleaned.balanceAccessToken
  }

  if (cleaned.type === 'custom' && cleaned.balanceEnabled) {
    cleaned.balanceApiPath =
      cleaned.balanceApiPath?.trim() || DEFAULT_BALANCE_API_PATH
    cleaned.balanceResultJsonKey =
      cleaned.balanceResultJsonKey?.trim() || DEFAULT_BALANCE_RESULT_JSON_KEY
  }

  if (cleaned.type !== 'yunwu') {
    delete cleaned.groupRatio
  }

  return cleaned
}

const isCompleteEndpoint = (endpoint: GptImageEndpoint) =>
  Boolean(
    endpoint.name && endpoint.baseURL && endpoint.model && endpoint.apiKey,
  )

const hasInvalidSpicyLora = (endpoint: GptImageEndpoint) =>
  endpoint.engine === 'spicyapi-images' &&
  endpoint.spicyLoras?.some((lora) => {
    try {
      return (
        !['https:', 'http:'].includes(new URL(lora.path).protocol) ||
        !Number.isFinite(lora.scale) ||
        lora.scale < 0 ||
        lora.scale > 4
      )
    } catch {
      return true
    }
  })

export const GPTImageSetting = forwardRef<GPTImageSettingRef>((_props, ref) => {
  useAppLanguage()

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
  const isVeniceEndpoint =
    activeEndpoint?.type === 'venice' ||
    activeEndpoint?.engine === 'venice-images'
  const isNovelAIEndpoint = activeEndpoint?.engine === 'novelai-images'
  const isSpicyEndpoint = activeEndpoint?.engine === 'spicyapi-images'
  const isAPIMartEndpoint = activeEndpoint?.engine === 'apimart-images'
  const isGeminiEndpoint = activeEndpoint?.engine === 'gemini-images'
  const isLaoZhangEndpoint =
    activeEndpoint && usesLaoZhangImages(activeEndpoint)
  const laoZhangModel = normalizeLaoZhangModel(activeEndpoint?.model || '')
  const laoZhangFamily = getLaoZhangImageFamily(laoZhangModel)
  const isOpenAIImagesEndpoint = activeEndpoint?.engine === 'openai-images'
  const imageModelCatalog: EndpointModelCatalog = isGeminiEndpoint
    ? 'gemini-image'
    : isSpicyEndpoint
      ? 'spicyapi-image-generation'
      : isLaoZhangEndpoint
        ? 'laozhang-image'
        : isVeniceEndpoint
          ? 'venice-image'
          : isNovelAIEndpoint
            ? 'novelai-image'
            : activeEndpoint?.engine === 'openrouter-images'
              ? 'openrouter-images'
              : isOpenAIImagesEndpoint || isAPIMartEndpoint
                ? 'openai-image-generation'
                : 'openai-image'
  const {
    models: imageModels,
    loading: loadingImageModels,
    error: imageModelsError,
    refresh: refreshImageModels,
  } = useEndpointModels({
    catalog: imageModelCatalog,
    baseURL: activeEndpoint?.baseURL,
    apiKey: activeEndpoint?.apiKey,
    enabled: Boolean(activeEndpoint),
  })
  const {
    models: editModels,
    loading: loadingEditModels,
    error: editModelsError,
    refresh: refreshEditModels,
  } = useEndpointModels({
    catalog: isGeminiEndpoint
      ? 'gemini-image'
      : isSpicyEndpoint
        ? 'spicyapi-image-edit'
        : isLaoZhangEndpoint
          ? 'laozhang-image'
          : isVeniceEndpoint
            ? 'venice-inpaint'
            : 'openai-image-edit',
    baseURL: activeEndpoint?.baseURL,
    apiKey: activeEndpoint?.apiKey,
    enabled:
      isGeminiEndpoint ||
      isLaoZhangEndpoint ||
      isVeniceEndpoint ||
      isOpenAIImagesEndpoint ||
      isAPIMartEndpoint ||
      isSpicyEndpoint,
  })

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
          defaultEndpointId: resolveImageEndpointId(next),
        }))
      }
      return next
    })
  }

  const handleSetDefaultEndpoint = (id: string) => {
    setGptImageSettings((prev) => ({ ...prev, defaultEndpointId: id }))
    message.success(t('已设为默认端点'))
  }

  const handleToggleEndpoint = async () => {
    if (!activeEndpoint) return
    const { id } = activeEndpoint
    const disabled = !activeEndpoint.disabled
    const savedEndpoint = endpoints.find((endpoint) => endpoint.id === id)

    // 已保存的端点只更新停用状态，保留各端点尚未保存的编辑内容。
    if (savedEndpoint) {
      setUpdatingEndpoint(true)
      skipNextEndpointSyncRef.current = true
      try {
        const next = endpoints.map((endpoint) =>
          endpoint.id === id ? { ...endpoint, disabled } : endpoint,
        )
        if (!(await saveEndpoints(next))) {
          skipNextEndpointSyncRef.current = false
          message.error(t('端点状态更新失败'))
          return
        }
        setGptImageSettings((prev) => ({
          ...prev,
          defaultEndpointId: resolveImageEndpointId(
            next,
            prev.defaultEndpointId,
          ),
          selectedEndpointId: resolveImageEndpointId(
            next,
            prev.selectedEndpointId,
            prev.defaultEndpointId,
          ),
        }))
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
    if (hasInvalidSpicyLora(cleanedEndpoint)) {
      message.warning(t('请填写有效的 LoRA URL 和 0–4 权重，或移除空白 LoRA'))
      return
    }
    if (!isCompleteEndpoint(cleanedEndpoint)) {
      message.warning(t('请完整配置当前端点（名称/地址/模型/Key）'))
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
        message.error(t('当前端点更新失败'))
        return
      }
      const savedEndpoint =
        useGlobalStore
          .getState()
          .endpoints.find((e) => e.id === cleanedEndpoint.id) || cleanedEndpoint
      setDraftEndpoints((list) =>
        list.some((e) => e.id === cleanedEndpoint.id)
          ? list.map((e) => (e.id === cleanedEndpoint.id ? savedEndpoint : e))
          : [...list, savedEndpoint],
      )
      setPendingPresetEndpoint(null)
      setActiveId(cleanedEndpoint.id)
      message.success(t('当前端点已更新'))
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
      if (cleaned.some(hasInvalidSpicyLora)) {
        const error = t('请填写有效的 LoRA URL 和 0–4 权重，或移除空白 LoRA')
        message.warning(error)
        throw new Error(error)
      }
      if (cleaned.length === 0) {
        message.warning(t('请至少完整配置一个端点（名称/地址/模型/Key）'))
        throw new Error('No endpoint')
      }
      const saved = await saveEndpoints(cleaned)
      if (!saved) {
        message.error(t('端点配置保存失败'))
        throw new Error('Failed to save endpoints')
      }
      setDraftEndpoints(useGlobalStore.getState().endpoints)
      if (pendingPresetEndpoint && isCompleteEndpoint(pendingPresetEndpoint)) {
        setActiveId(pendingPresetEndpoint.id)
      }
      setPendingPresetEndpoint(null)

      const values = await form.validateFields()
      setGptImageSettings((prev) => {
        const defaultEndpointId = resolveImageEndpointId(
          cleaned,
          prev.defaultEndpointId,
        )
        const selectedEndpointId = resolveImageEndpointId(
          cleaned,
          prev.selectedEndpointId,
          defaultEndpointId,
        )

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
      message.success(t('配置保存成功'))
      return cleaned[0]?.apiKey
    },
  }))

  return (
    <div className="px-4 py-2">
      <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 shadow-[inset_3px_0_0_rgba(228,173,58,0.75)]">
        <ExclamationCircleOutlined className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-amber-200">
            {t('警惕第三方中转站风险')}
          </div>
          <div className="mt-1 text-xs leading-5 text-amber-100/75">
            {t(
              '请勿填写真实密码等无关敏感信息；充值前请核实平台口碑与运营方，建议小额试用、随用随充。预设仅用于填写公开参数，不代表对服务商的背书。',
            )}
          </div>
        </div>
      </div>
      <Form form={form} layout="vertical">
        {/* —— 端点列表管理 —— */}
        <div className="mb-2 text-sm text-slate-400">{t('图片生成端点')}</div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={pendingPresetEndpoint ? undefined : activeEndpoint?.id}
            placeholder={
              pendingPresetEndpoint
                ? t('预设草稿：{0}', [pendingPresetEndpoint.name])
                : t('选择端点')
            }
            onChange={handleSelectEndpoint}
            className="min-w-40 flex-1"
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
            options={GPT_IMAGE_ENDPOINT_PRESETS.map((preset) => ({
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
                placeholder={t('如 OpenLux、OpenAI 官方')}
              />
            </Form.Item>
            <Form.Item label={t('API 地址 (baseURL)')} required>
              <Input
                value={activeEndpoint.baseURL}
                onChange={(e) =>
                  updateActiveEndpoint({ baseURL: e.target.value })
                }
                placeholder={
                  isGeminiEndpoint
                    ? GEMINI_BASE_URL
                    : isSpicyEndpoint
                    ? SPICY_API_BASE_URL
                    : isLaoZhangEndpoint
                      ? LAOZHANG_BASE_URL
                      : activeEndpoint.engine === 'venice-images'
                        ? DEFAULT_VENICE_BASE_URL
                        : isAPIMartEndpoint
                          ? 'https://api.apimart.ai/v1'
                          : activeEndpoint.engine === 'novelai-images'
                            ? DEFAULT_NOVELAI_BASE_URL
                            : activeEndpoint.engine === 'chat-completions' ||
                                activeEndpoint.engine === 'openrouter-images'
                              ? t('如 https://openrouter.ai/api/v1')
                              : t('如 https://api.openlux.ai/v1')
                }
              />
            </Form.Item>
            <Form.Item label={t('模型 ID')} required>
              <ModelIdInput
                value={activeEndpoint.model}
                onChange={(model) =>
                  updateActiveEndpoint({
                    model,
                    ...(isLaoZhangEndpoint
                      ? {
                          laozhangQuality: undefined,
                          laozhangTransparentBackground: false,
                        }
                      : {}),
                  })
                }
                models={imageModels}
                loading={loadingImageModels}
                error={imageModelsError}
                onRefresh={refreshImageModels}
                directoryLabel={
                  isGeminiEndpoint
                    ? t('Gemini 图片模型目录')
                    : isLaoZhangEndpoint
                    ? t('老张图片模型目录')
                    : imageModelCatalog === 'openrouter-images'
                      ? t('OpenRouter Images 模型目录')
                      : isNovelAIEndpoint
                        ? t('NovelAI 图片模型目录')
                        : isVeniceEndpoint
                          ? t('Venice 生成模型目录')
                          : t('图片生成/编辑模型目录')
                }
                waitingForKey={!activeEndpoint.apiKey.trim()}
                placeholder={
                  isGeminiEndpoint
                    ? t('搜索或输入模型 ID，如 gemini-nano-banana-2.1')
                    : activeEndpoint.engine === 'chat-completions'
                    ? t('搜索或输入模型 ID，如 google/gemini-2.5-flash-image')
                    : activeEndpoint.engine === 'openrouter-images'
                      ? t('搜索或输入模型 ID，如 google/gemini-3.1-flash-image')
                      : isVeniceEndpoint
                        ? t('搜索或输入 Venice 生成模型 ID')
                        : isNovelAIEndpoint
                          ? t('选择或输入 NovelAI 图片模型 ID')
                          : t('搜索或输入模型 ID，如 gpt-image-2')
                }
              />
              <div className="mt-1 text-xs text-slate-500">
                {t(
                  '候选列表只显示支持图片生成的模型；目录未收录的模型仍可手动输入。',
                )}
              </div>
            </Form.Item>
            {(isGeminiEndpoint ||
              isLaoZhangEndpoint ||
              isVeniceEndpoint ||
              isOpenAIImagesEndpoint ||
              isAPIMartEndpoint ||
              isSpicyEndpoint) && (
              <Form.Item label={t('参考图编辑模型 ID')}>
                <ModelIdInput
                  value={activeEndpoint.editModel}
                  onChange={(editModel) =>
                    updateActiveEndpoint({ editModel: editModel || undefined })
                  }
                  models={editModels}
                  loading={loadingEditModels}
                  error={editModelsError}
                  onRefresh={refreshEditModels}
                  directoryLabel={
                    isGeminiEndpoint
                      ? t('Gemini 图片模型目录')
                      : isLaoZhangEndpoint
                      ? t('老张图片模型目录')
                      : isSpicyEndpoint
                        ? t('SpicyAPI 编辑模型目录')
                        : isAPIMartEndpoint
                          ? t('APImart 编辑模型目录')
                          : isVeniceEndpoint
                            ? t('Venice 编辑模型目录')
                            : t('OpenAI Images 编辑模型目录')
                  }
                  waitingForKey={!activeEndpoint.apiKey.trim()}
                  placeholder={
                    isGeminiEndpoint || isLaoZhangEndpoint
                      ? t('搜索或输入参考图模型 ID；留空则沿用生成模型')
                      : isAPIMartEndpoint || isSpicyEndpoint
                        ? t('搜索或输入参考图模型 ID；留空则沿用生成模型')
                        : isVeniceEndpoint
                          ? t('搜索或输入编辑模型 ID；使用参考图时必填')
                          : t(
                              '搜索或输入支持 /images/edits 的模型；留空则沿用生成模型',
                            )
                  }
                  allowClear
                />
              </Form.Item>
            )}
            <Form.Item label="API Key" required>
              <Input.Password
                value={activeEndpoint.apiKey}
                onChange={(e) =>
                  updateActiveEndpoint({ apiKey: e.target.value })
                }
                placeholder={t('输入该端点的 API Key')}
              />
            </Form.Item>
            <Form.Item label={t('生成引擎')} required>
              <Radio.Group
                value={activeEndpoint.engine || 'openai-images'}
                onChange={(e) => {
                  const engine = e.target.value
                  updateActiveEndpoint({
                    engine,
                    ...(isGeminiEndpoint &&
                    ['openai-images', 'chat-completions', 'openrouter-images'].includes(engine)
                      ? {
                          baseURL: engine === 'openai-images'
                            ? DEFAULT_OPENAI_IMAGES_BASE_URL : DEFAULT_OPENROUTER_BASE_URL,
                          model: engine === 'openai-images'
                            ? DEFAULT_MODEL : engine === 'chat-completions'
                              ? DEFAULT_CHAT_MODEL : DEFAULT_OPENROUTER_MODEL,
                          editModel: undefined,
                          type: engine === 'openai-images'
                            ? 'custom' as const : 'openrouter' as const,
                          balanceEnabled: false,
                        }
                      : {}),
                    ...(engine === 'gemini-images'
                      ? {
                          baseURL: GEMINI_BASE_URL,
                          type: 'custom' as const,
                          model: GEMINI_IMAGE_MODEL,
                          editModel: undefined,
                          balanceEnabled: false,
                        }
                      : {}),
                    ...(engine === 'laozhang-images'
                      ? {
                          baseURL: LAOZHANG_BASE_URL,
                          type: 'laozhang' as const,
                          model: 'gpt-image-2-vip',
                          editModel: undefined,
                          balanceEnabled: false,
                        }
                      : {}),
                    ...(engine === 'spicyapi-images'
                      ? {
                          baseURL: SPICY_API_BASE_URL,
                          type: 'custom' as const,
                          model: SPICY_SEEDREAM_MODEL,
                          editModel: 'bytedance/seedream-5.0-flash/edit',
                          balanceEnabled: true,
                          balanceApiPath: '/chat/credit',
                          balanceResultJsonKey: 'data.available',
                        }
                      : {}),
                    // 切换引擎时给出对应默认值，减少用户手动改的麻烦
                    ...(engine === 'apimart-images'
                      ? {
                          baseURL: 'https://api.apimart.ai/v1',
                          type: 'custom' as const,
                          model: 'gpt-image-2',
                          editModel: undefined,
                          balanceEnabled: true,
                          balanceApiPath: '/balance',
                          balanceResultJsonKey: 'remain_balance',
                        }
                      : {}),
                    ...(engine === 'chat-completions' &&
                    [DEFAULT_MODEL, DEFAULT_NOVELAI_MODEL].includes(
                      activeEndpoint.model,
                    )
                      ? { model: DEFAULT_CHAT_MODEL }
                      : {}),
                    ...(engine === 'openrouter-images' &&
                    [
                      DEFAULT_MODEL,
                      DEFAULT_CHAT_MODEL,
                      DEFAULT_NOVELAI_MODEL,
                    ].includes(activeEndpoint.model)
                      ? { model: DEFAULT_OPENROUTER_MODEL }
                      : {}),
                    ...(engine === 'venice-images'
                      ? {
                          baseURL: DEFAULT_VENICE_BASE_URL,
                          type: 'venice' as const,
                          model: 'gpt-image-2',
                          editModel: 'gpt-image-2-edit',
                        }
                      : {}),
                    ...(engine === 'novelai-images'
                      ? {
                          baseURL: DEFAULT_NOVELAI_BASE_URL,
                          type: 'custom' as const,
                          model: DEFAULT_NOVELAI_MODEL,
                          editModel: undefined,
                        }
                      : {}),
                    ...(engine === 'openai-images' &&
                    [
                      DEFAULT_CHAT_MODEL,
                      DEFAULT_OPENROUTER_MODEL,
                      DEFAULT_NOVELAI_MODEL,
                    ].includes(activeEndpoint.model)
                      ? { model: DEFAULT_MODEL }
                      : {}),
                    ...((engine === 'openrouter-images' ||
                      engine === 'chat-completions') &&
                    activeEndpoint.baseURL === DEFAULT_OPENAI_IMAGES_BASE_URL
                      ? {
                          baseURL: DEFAULT_OPENROUTER_BASE_URL,
                          type: 'openrouter' as const,
                        }
                      : {}),
                    ...(engine === 'openai-images' &&
                    activeEndpoint.baseURL === DEFAULT_OPENROUTER_BASE_URL
                      ? { baseURL: DEFAULT_OPENAI_IMAGES_BASE_URL }
                      : {}),
                    ...(engine !== 'venice-images' &&
                    engine !== 'openai-images' &&
                    engine !== 'apimart-images' &&
                    engine !== 'spicyapi-images' &&
                    engine !== 'gemini-images' &&
                    engine !== 'laozhang-images'
                      ? { editModel: undefined }
                      : {}),
                    ...((engine === 'openrouter-images' ||
                      engine === 'chat-completions') &&
                    [
                      DEFAULT_VENICE_BASE_URL,
                      DEFAULT_NOVELAI_BASE_URL,
                    ].includes(activeEndpoint.baseURL)
                      ? {
                          baseURL: DEFAULT_OPENROUTER_BASE_URL,
                          type: 'openrouter' as const,
                        }
                      : {}),
                    ...(engine === 'openai-images' &&
                    [
                      DEFAULT_VENICE_BASE_URL,
                      DEFAULT_NOVELAI_BASE_URL,
                    ].includes(activeEndpoint.baseURL)
                      ? {
                          baseURL: DEFAULT_OPENAI_IMAGES_BASE_URL,
                          type: 'custom' as const,
                        }
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
                <Radio.Button value="venice-images">Venice Images</Radio.Button>
                <Radio.Button value="novelai-images">NovelAI</Radio.Button>
                <Radio.Button value="spicyapi-images">
                  SpicyAPI Images
                </Radio.Button>
                <Radio.Button value="apimart-images">
                  APImart Images
                </Radio.Button>
                <Radio.Button value="laozhang-images">
                  {t('老张 API')}
                </Radio.Button>
                <Radio.Button value="gemini-images">
                  {t('Gemini 原生')}
                </Radio.Button>
                <Radio.Button value="chat-completions">
                  {t('聊天式（Nano Banana 等）')}
                </Radio.Button>
              </Radio.Group>
              {isGeminiEndpoint && (
                <div className="mt-1 text-xs text-slate-500">
                  {t('使用 Google Gemini API Key，支持文生图与参考图编辑')}
                  <br />
                  {t(
                    'Nano Banana 2.1 / 2 / Pro 支持 1K、2K、4K；Lite / Standard 仅支持 1K。质量由模型决定，多图按单张请求生成。',
                  )}
                  <br />
                  {t('最多 14 张参考图，Standard 最多 3 张；不支持的比例或分辨率会在提交前提示。')}
                </div>
              )}
              {isAPIMartEndpoint && (
                <div className="mt-1 text-xs text-slate-500">
                  {t(
                    'APImart 自动查询异步任务；按模型能力传递比例、分辨率与参考图，多图生成拆成单图请求。',
                  )}
                </div>
              )}
              <div className="mt-1 text-xs text-slate-500">
                {t(
                  'GPT Image / DALL·E 使用 OpenAI 兼容接口；OpenRouter Images 使用专用 /images；Venice Images 使用原生生成/编辑接口并按实时模型能力传参；NovelAI 使用原生 /ai/generate-image；聊天式使用 chat/completions，并通过 image_config 传递图片参数。',
                )}
              </div>
            </Form.Item>
            {isGeminiEndpoint && (
              <GeminiEndpointSettings
                endpoint={activeEndpoint}
                onChange={updateActiveEndpoint}
              />
            )}
            {isSpicyEndpoint && (
              <div className="mb-4 rounded-lg border border-slate-700 p-3">
                <div className="mb-3 text-xs text-slate-500">
                  {t(
                    'SpicyAPI 自动上传参考图并查询异步任务，质量由模型决定；比例、分辨率和 LoRA 参数按当前模型定义校验。',
                  )}
                </div>
                <Form.Item label={t('SpicyAPI 分辨率覆盖')}>
                  <Select<'1k' | '1.5k' | '2k' | ''>
                    value={activeEndpoint.spicyResolution || ''}
                    onChange={(value) =>
                      updateActiveEndpoint({
                        spicyResolution: value || undefined,
                      })
                    }
                    options={[
                      { value: '', label: t('沿用任务分辨率') },
                      ...['1k', '1.5k', '2k'].map((value) => ({
                        value,
                        label: value.toUpperCase(),
                      })),
                    ]}
                  />
                </Form.Item>
                <Form.Item label="Seed">
                  <InputNumber
                    min={0}
                    max={2147483647}
                    precision={0}
                    className="w-full"
                    value={activeEndpoint.spicySeed}
                    onChange={(value) =>
                      updateActiveEndpoint({ spicySeed: value ?? undefined })
                    }
                    placeholder={t('留空则随机生成')}
                  />
                </Form.Item>
                <div className="mb-2 text-sm">{t('LoRA 地址与权重')}</div>
                <div className="mb-2 text-xs text-slate-500">
                  {t(
                    '所有 SpicyAPI 模型均可配置；仅填写后发送，数量和权重按当前模型定义校验。不支持 LoRA 的模型请保持列表为空。',
                  )}
                </div>
                {(activeEndpoint.spicyLoras || []).map((lora, index) => (
                  <LoraWeightRow
                    key={index}
                    label={lora.path || 'LoRA ' + (index + 1)}
                    min={0}
                    max={4}
                    value={lora.scale}
                    editor={
                      <Input
                        value={lora.path}
                        placeholder={t('LoRA 文件或 Hugging Face 的完整 URL')}
                        onChange={(e) =>
                          updateActiveEndpoint({
                            spicyLoras: activeEndpoint.spicyLoras?.map(
                              (item, i) =>
                                i === index
                                  ? { ...item, path: e.target.value }
                                  : item,
                            ),
                          })
                        }
                      />
                    }
                    onChange={(scale) =>
                      updateActiveEndpoint({
                        spicyLoras: activeEndpoint.spicyLoras?.map((item, i) =>
                          i === index ? { ...item, scale } : item,
                        ),
                      })
                    }
                    onRemove={() =>
                      updateActiveEndpoint({
                        spicyLoras: activeEndpoint.spicyLoras?.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  />
                ))}
                <Button
                  icon={<PlusOutlined />}
                  onClick={() =>
                    updateActiveEndpoint({
                      spicyLoras: [
                        ...(activeEndpoint.spicyLoras || []),
                        { path: '', scale: 1 },
                      ],
                    })
                  }
                >
                  {t('添加 LoRA')}
                </Button>
              </div>
            )}
            {isLaoZhangEndpoint && (
              <div className="mb-4 rounded-md border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-3 text-xs text-slate-500">
                  {t(
                    '老张按模型自动选择 Images、Gemini 原生或 Seedream 接口。多图拆成单张请求；不支持的尺寸会在提交前提示。',
                  )}
                </div>
                {laoZhangModel === 'gpt-image-2' && (
                  <Form.Item label={t('GPT Image 2 线路')}>
                    <Select
                      value={activeEndpoint.laozhangGptImage2Mode || 'per-call'}
                      onChange={(laozhangGptImage2Mode) =>
                        updateActiveEndpoint({ laozhangGptImage2Mode })
                      }
                      options={[
                        {
                          value: 'per-call',
                          label: t('按次（不传尺寸和质量）'),
                        },
                        { value: 'official', label: t('官转（传尺寸和质量）') },
                      ]}
                    />
                    <div className="mt-1 text-xs text-slate-500">
                      {t(
                        '这里仅决定请求参数；实际线路由老张控制台中 API Key 的分组决定。',
                      )}
                    </div>
                  </Form.Item>
                )}
                {(laoZhangFamily === 'grok' ||
                  (laoZhangFamily === 'gpt' &&
                    laoZhangModel !== 'gpt-image-2.5-web')) &&
                  (laoZhangModel !== 'gpt-image-2' ||
                    activeEndpoint.laozhangGptImage2Mode === 'official') && (
                    <Form.Item label={t('老张质量档位')}>
                      <Select
                        allowClear
                        value={activeEndpoint.laozhangQuality}
                        placeholder={
                          laoZhangFamily === 'grok'
                            ? 'medium'
                            : t('沿用任务质量')
                        }
                        onChange={(laozhangQuality) =>
                          updateActiveEndpoint({ laozhangQuality })
                        }
                        options={(laoZhangFamily === 'grok'
                          ? ['low', 'medium']
                          : laoZhangModel.startsWith('gpt-image-2.5-')
                            ? ['low', 'medium', 'high', 'xhigh', 'max']
                            : ['low', 'medium', 'high']
                        ).map((value) => ({ value, label: value }))}
                      />
                    </Form.Item>
                  )}
                {/^gpt-image-2\.5-(flare|sunburst)-vip$/.test(
                  laoZhangModel,
                ) && (
                  <Form.Item label={t('透明背景 PNG')} className="mb-0">
                    <Switch
                      checked={
                        activeEndpoint.laozhangTransparentBackground || false
                      }
                      onChange={(laozhangTransparentBackground) =>
                        updateActiveEndpoint({ laozhangTransparentBackground })
                      }
                    />
                  </Form.Item>
                )}
                {laoZhangFamily === 'gemini' && (
                  <div className="text-xs text-slate-500">
                    {t(
                      'Nano Banana 2 / Pro 支持 1K、2K、4K；Lite / Standard 仅支持 1K。2:1、1:2、9:21 映射为邻近支持比例。',
                    )}
                  </div>
                )}
                {laoZhangFamily === 'seedream' && (
                  <div className="text-xs text-slate-500">
                    {t(
                      'Seedream 5.0 Flash / Pro 支持 1K、2K；5.0 支持 2K；4.5 支持 2K、4K；4.0 支持 1K、2K、4K。',
                    )}
                  </div>
                )}
                {laoZhangFamily === 'grok' && (
                  <div className="text-xs text-slate-500">
                    {t(
                      'Grok 2.0 支持 1K、2K，生成质量默认 medium；编辑最多 3 张参考图，分辨率和质量由服务端决定。',
                    )}
                  </div>
                )}
                {laoZhangModel === 'gpt-image-2.5-web' && (
                  <div className="text-xs text-slate-500">
                    {t('网页版支持尺寸设置；质量由服务端决定。')}
                  </div>
                )}
              </div>
            )}
            <Form.Item label={t('端点类型')} required>
              <Radio.Group
                value={activeEndpoint.type}
                onChange={(e) => {
                  const type = e.target.value as GptImageEndpoint['type']
                  updateActiveEndpoint({
                    type,
                    ...(type === 'laozhang'
                      ? {
                          baseURL: LAOZHANG_BASE_URL,
                          engine: 'laozhang-images' as const,
                          model: 'gpt-image-2-vip',
                          editModel: undefined,
                          balanceEnabled: false,
                        }
                      : {}),
                    ...(type === 'venice'
                      ? {
                          baseURL: DEFAULT_VENICE_BASE_URL,
                          engine: 'venice-images' as const,
                          model: 'gpt-image-2',
                          editModel: 'gpt-image-2-edit',
                        }
                      : {}),
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
                <Radio.Button value="yunwu">New API</Radio.Button>
                <Radio.Button value="openrouter">OpenRouter</Radio.Button>
                <Radio.Button value="venice">Venice</Radio.Button>
                <Radio.Button value="laozhang">{t('老张 API')}</Radio.Button>
                <Radio.Button value="custom">{t('自定义')}</Radio.Button>
              </Radio.Group>
              <div className="mt-1 text-xs text-slate-500">
                {t(
                  'New API 使用当前站点的 /api/usage/token/；OpenRouter 使用官方余额接口；Venice 同时读取 USD 与 DIEM；其他端点可在“自定义”中配置余额路径。',
                )}
              </div>
            </Form.Item>
            {activeEndpoint.type === 'yunwu' && (
              <Form.Item label={t('估算分组倍率')}>
                <InputNumber
                  className="w-full"
                  min={0}
                  step={0.01}
                  value={activeEndpoint.groupRatio}
                  onChange={(groupRatio) =>
                    updateActiveEndpoint({
                      groupRatio: groupRatio ?? undefined,
                    })
                  }
                  placeholder={t('留空按 1 倍估算')}
                />
                <div className="mt-1 text-xs text-slate-500">
                  {t(
                    '填写这把 Key 在 New API 中使用的分组倍率。仅在未取得实际消费日志时参与估算；实际扣费仍以日志为准。',
                  )}
                </div>
              </Form.Item>
            )}
            {activeEndpoint.type === 'laozhang' && (
              <div className="mb-4 rounded-md border border-white/10 bg-white/[0.03] p-3">
                <Form.Item label={t('获取账户余额')}>
                  <Switch
                    checked={activeEndpoint.balanceEnabled || false}
                    onChange={(balanceEnabled) =>
                      updateActiveEndpoint({ balanceEnabled })
                    }
                  />
                </Form.Item>
                {activeEndpoint.balanceEnabled && (
                  <Form.Item label={t('系统 AccessToken')} className="mb-0">
                    <Input.Password
                      value={activeEndpoint.balanceAccessToken || ''}
                      autoComplete="new-password"
                      onChange={(e) =>
                        updateActiveEndpoint({
                          balanceAccessToken: e.target.value,
                        })
                      }
                      placeholder={
                        activeEndpoint.balanceAccessTokenConfigured
                          ? t('已配置；留空保留，输入新令牌替换')
                          : t('输入老张系统 AccessToken（不是生图 API Key）')
                      }
                    />
                    {activeEndpoint.balanceAccessTokenConfigured && (
                      <Button
                        type="link"
                        onClick={() =>
                          updateActiveEndpoint({
                            balanceAccessToken: '',
                            balanceAccessTokenConfigured: false,
                          })
                        }
                      >
                        {t('清除余额令牌')}
                      </Button>
                    )}
                    <div className="mt-1 text-xs text-slate-500">
                      {t(
                        '令牌仅保存在服务端，不回传浏览器；余额显示整个账户的美元余额。',
                      )}
                    </div>
                  </Form.Item>
                )}
              </div>
            )}
            {isGeminiEndpoint && <GeminiBalanceHelp />}
            {activeEndpoint.type === 'custom' && (
              <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">
                      {t('获取账户余额')}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {t(
                        '使用当前 API Key 发起 GET 请求，并从响应 JSON 中读取余额。',
                      )}
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
                    <Form.Item
                      label={t('余额API路径')}
                      className="mb-0"
                      required
                    >
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
                    <Form.Item
                      label={t('结果JSON键')}
                      className="mb-0"
                      required
                    >
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
                disabled={
                  Boolean(pendingPresetEndpoint) || activeEndpoint.disabled
                }
                type={
                  gptImageSettings.defaultEndpointId === activeEndpoint.id
                    ? 'primary'
                    : 'default'
                }
                onClick={() => handleSetDefaultEndpoint(activeEndpoint.id)}
              >
                {gptImageSettings.defaultEndpointId === activeEndpoint.id
                  ? t('当前默认端点')
                  : t('设为默认端点')}
              </Button>
              <span className="text-xs text-slate-500">
                {pendingPresetEndpoint
                  ? t('请先更新或保存预设端点，再设为默认端点')
                  : t('刷新网页后图片生成会默认使用此端点')}
              </span>
            </div>
          </div>
        )}

        <div className="my-3 border-t border-white/10" />

        {/* —— 生成参数（与端点无关，本地设置） —— */}
        <Form.Item>
          <div className="mb-2 text-sm text-slate-400">{t('生成尺寸')}</div>
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
              {isGeminiEndpoint ? (
                <div>{t('Gemini 按模型支持的原生分辨率生成，不进行 GPT Image 的总像素缩放。')}</div>
              ) : isPublic ? (
                <div>{t('公用 API Key 无法使用 4K 画质')}</div>
              ) : (
                <>
                  <div>{t('开启 4K 后，Token 消耗是 2K 的 2~4 倍')}</div>
                  <div>{t('单张图片可能产生 0.2 元以上的费用')}</div>
                  <div>{t('图片将按比例缩放到总像素不超过 8294400')}</div>
                  <div>{t('更容易失败或命中高倍率的分组')}</div>
                </>
              )}
            </div>
          </div>
        </Form.Item>
        <Form.Item>
          <div className="mb-2 text-sm text-slate-400">{t('画质设置')}</div>
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
              {isGeminiEndpoint ? (
                <div>{t('Gemini 的质量由模型决定，Medium / High 设置不会影响该端点。')}</div>
              ) : isPublic ? (
                <div>{t('公用 API Key 无法使用 High 画质')}</div>
              ) : (
                <>
                  <div>{t('High 画质处理小字扭曲等细节效果更好')} </div>
                  <div>
                    {t(
                      '但 Token 消耗大约变为 4倍，整体性价比远不如提升画面尺寸',
                    )}
                  </div>
                  <div>{t('更容易失败或命中高倍率的分组')}</div>
                </>
              )}
            </div>
          </div>
        </Form.Item>
        <Form.Item>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg">
              <span className="text-sm text-slate-400">{t('生成多张')}</span>
              <Form.Item name="enableMultiple" valuePropName="checked" noStyle>
                <Switch disabled={isPublic} />
              </Form.Item>
            </div>
          </div>
          <div className="mt-1 flex items-start gap-1 text-xs text-red-500">
            <ExclamationCircleOutlined className="mt-1" />
            {isPublic ? (
              <div>{t('公用 API Key 无法一次生成多张')}</div>
            ) : (
              <div>
                <div>{t('生成多张与提交多次相同任务的效果和开销完全等价')}</div>
                <div>{t('不会节省输入费用，不同张数之间也没有前后关联')}</div>
              </div>
            )}
          </div>
        </Form.Item>
      </Form>
    </div>
  )
})
