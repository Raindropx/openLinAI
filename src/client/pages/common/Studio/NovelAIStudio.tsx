import {
  BulbOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  MinusCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Segmented,
  Select,
  Slider,
  Space,
  Switch,
  Upload,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import { studioFileUrl, type StudioItem } from '../../../../shared/studio'
import {
  calculateNovelAIImg2ImgSize,
  NOVELAI_IMAGE_MODELS,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
  type NovelAIStudioGenerateRequest,
  type StudioProviderSettings,
} from '../../../../shared/studio-generation'
import {
  requestChatCompletion,
  type ChatContentPart,
  type ChatMessage,
} from '../../../hooks/useChatCompletion'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { t, useAppLanguage } from '../../../i18n'
import { useGlobalStore } from '../../../store/global'
import { imageBlobToUploadDataUrl } from '../../../utils/image'
import {
  uploadInputImageBase64,
  uploadInputImageFromUrl,
} from '../../../utils/uploadInputImage'
import { openGallery } from '../components/Gallery'
import { openSettingModal } from '../SettingModal'
import {
  generateNovelAIStudioImages,
  testStudioProvider,
  updateNovelAISettings,
  uploadNovelAIMask,
} from './api'
import { parseNovelAIOptimizedPrompt } from './novelai-prompt'
import { NovelAICanvas } from './NovelAICanvas'
import { NovelAICharacterImagePrompt } from './NovelAICharacterImagePrompt'
import { ProviderKeyCard } from './ProviderKeyCard'
import type { StudioGenerationParameters } from './studio-parameters'
import {
  PRESET_FIELDS,
  PresetSaveButton,
  type PresetField,
  type PresetValues,
  type StudioPreset,
} from './studio-presets'

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
  qualityPreset: 'standard',
  ucPreset: 0,
  action: 'generate',
  inpaintBase: 'original',
  focusedInpaint: true,
  inpaintContextPixels: 128,
  inpaintFeatherPixels: 20,
  inpaintEdgeFeatherPixels: 8,
  inpaintBlendMode: 'soft',
  saveInpaintRaw: true,
  strength: 0.7,
  noise: 0.1,
  characters: [],
}

const NOVELAI_REFERENCE_MAX_DIMENSION = 2048
const NOVELAI_REFERENCE_MAX_BYTES = 16 * 1024 * 1024
const REFERENCE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/svg+xml,.svg'

interface SelectedReferenceImage {
  url: string
  name: string
  source: '暂存台' | '图库' | '上传文件'
  sourceId?: string
  sourceWidth: number
  sourceHeight: number
  targetWidth: number
  targetHeight: number
}

function readImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error(t('无法读取参考图尺寸')))
    image.src = url
  })
}

export function NovelAIStudio({
  settings,
  items,
  onSettings,
  onItems,
  selectedItemId,
  onSelectItem,
  mobilePanel,
  onMobilePanel,
  incomingRequest,
  incomingParameters,
  incomingReference,
  incomingPreset,
  onSavePreset,
  onOpenPhotopea,
}: {
  settings: StudioProviderSettings['novelai']
  items: StudioItem[]
  onSettings: (settings: StudioProviderSettings) => void
  onItems: (items: StudioItem[]) => void
  selectedItemId?: string
  onSelectItem: (id: string) => void
  mobilePanel: 'parameters' | 'canvas'
  onMobilePanel: (panel: 'parameters' | 'canvas') => void
  incomingRequest?: { id: number; request: NovelAIStudioGenerateRequest }
  incomingParameters?: { id: number; values: StudioGenerationParameters }
  incomingReference?: { id: number; itemId: string }
  incomingPreset?: { id: number; preset: StudioPreset }
  onSavePreset: (preset: StudioPreset) => boolean
  onOpenPhotopea: (item: StudioItem) => void
}) {
  useAppLanguage()

  const [form] = Form.useForm<NovelAIStudioGenerateRequest>()
  const [generating, setGenerating] = useState(false)
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [referenceImage, setReferenceImage] =
    useState<SelectedReferenceImage | null>(null)
  const [maskDataUrl, setMaskDataUrl] = useState<string>()
  const [viewSource, setViewSource] = useState(false)
  const [preciseLoading, setPreciseLoading] = useState(false)
  const [promptMode, setPromptMode] = useState<'anime' | 'furry'>(() => {
    try {
      return window.localStorage.getItem('studio-novelai-prompt-mode') ===
        'furry'
        ? 'furry'
        : 'anime'
    } catch {
      return 'anime'
    }
  })
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [optimizeText, setOptimizeText] = useState('')
  const [optimizeImage, setOptimizeImage] = useState<{
    name: string
    url: string
    automatic?: boolean
  } | null>(null)
  const [optimizeLoading, setOptimizeLoading] = useState(false)
  const optimizeRequestId = useRef(0)
  const optimizeImageId = useRef(0)
  const touchedPresetFields = useRef(new Set<PresetField>())
  const { gptImageSettings, optimizeEndpointId, setOptimizeEndpointId } =
    useLocalSetting()
  const { llmEndpoints, llmPrompts } = useGlobalStore()
  const model = Form.useWatch('model', form) || settings.model
  const action = Form.useWatch('action', form) || 'generate'
  const focusedInpaint = Form.useWatch('focusedInpaint', form) ?? true
  const inpaintBlendMode =
    Form.useWatch('inpaintBlendMode', form) ?? INITIAL_VALUES.inpaintBlendMode
  const inpaintTransitionPixels =
    Form.useWatch('inpaintFeatherPixels', form) ??
    INITIAL_VALUES.inpaintFeatherPixels
  const targetWidth = Form.useWatch('width', { form, preserve: true }) || 1024
  const targetHeight = Form.useWatch('height', { form, preserve: true }) || 1024
  const preciseImageUrl = Form.useWatch(['preciseReference', 'imageUrl'], form)
  const selectedItem = items.find((item) => item.id === selectedItemId)
  const canvasImage =
    action === 'infill' || (viewSource && referenceImage)
      ? referenceImage?.url
      : selectedItem && selectedItem.format !== 'psd'
        ? studioFileUrl(selectedItem.id)
        : referenceImage?.url

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('studio-novelai-draft-v1')
      if (!saved) return
      const draft = JSON.parse(saved) as NovelAIStudioGenerateRequest
      form.setFieldsValue({
        ...INITIAL_VALUES,
        ...draft,
        inpaintBlendMode: draft.inpaintBlendMode ?? 'strict',
        inpaintEdgeFeatherPixels: Math.min(
          draft.inpaintFeatherPixels ?? 20,
          draft.inpaintEdgeFeatherPixels ?? 8,
        ),
      })
      setMaskDataUrl(draft.maskImageUrl)
      if (draft.referenceImageUrl) {
        void readImageSize(draft.referenceImageUrl)
          .then((size) =>
            setReferenceImage({
              url: draft.referenceImageUrl!,
              name: t('上次的参考图'),
              source: '图库',
              sourceWidth: size.width,
              sourceHeight: size.height,
              targetWidth: draft.width,
              targetHeight: draft.height,
            }),
          )
          .catch(() => form.setFieldValue('referenceImageUrl', undefined))
      }
    } catch {
      /* 私密模式或旧草稿损坏时仍可正常打开 */
    }
  }, [form])

  useEffect(() => {
    if (!incomingRequest) return
    const request = incomingRequest.request
    form.setFieldsValue({
      ...INITIAL_VALUES,
      ...request,
      inpaintBlendMode: request.inpaintBlendMode ?? 'strict',
      inpaintEdgeFeatherPixels: Math.min(
        request.inpaintFeatherPixels ?? 20,
        request.inpaintEdgeFeatherPixels ?? 8,
      ),
    })
    setPromptMode(
      /^\s*fur dataset\s*,/i.test(request.prompt) ? 'furry' : 'anime',
    )
    setMaskDataUrl(request.maskImageUrl)
    try {
      window.localStorage.setItem(
        'studio-novelai-draft-v1',
        JSON.stringify(request),
      )
    } catch {
      /* 浏览器禁用存储 */
    }
    setViewSource(Boolean(request.referenceImageUrl))
    if (request.referenceImageUrl) {
      void readImageSize(request.referenceImageUrl)
        .then((size) =>
          setReferenceImage({
            url: request.referenceImageUrl!,
            name: request.title || t('参考图'),
            source: '图库',
            sourceWidth: size.width,
            sourceHeight: size.height,
            targetWidth: request.width,
            targetHeight: request.height,
          }),
        )
        .catch(() => setReferenceImage(null))
    } else setReferenceImage(null)
  }, [form, incomingRequest])

  useEffect(() => {
    if (!incomingParameters) return
    const values = incomingParameters.values
    const validSize = (value: number | undefined) =>
      value !== undefined && value >= 64 && value <= 2048 && value % 64 === 0
    const unsupported =
      (values.width !== undefined && !validSize(values.width)) ||
      (values.height !== undefined && !validSize(values.height)) ||
      (values.steps !== undefined && (values.steps < 1 || values.steps > 50)) ||
      (values.scale !== undefined && (values.scale < 0 || values.scale > 10)) ||
      (values.seed !== undefined &&
        (values.seed < -1 || values.seed > 2147483647)) ||
      (values.sampler !== undefined &&
        !NOVELAI_SAMPLERS.includes(
          values.sampler as NovelAIStudioGenerateRequest['sampler'],
        ))
    form.setFieldsValue({
      prompt: values.prompt ?? '',
      negativePrompt: values.negativePrompt ?? '',
      ...(validSize(values.width) ? { width: values.width } : {}),
      ...(validSize(values.height) ? { height: values.height } : {}),
      ...(values.steps !== undefined && values.steps >= 1 && values.steps <= 50
        ? { steps: values.steps }
        : {}),
      ...(values.sampler &&
      NOVELAI_SAMPLERS.includes(
        values.sampler as NovelAIStudioGenerateRequest['sampler'],
      )
        ? { sampler: values.sampler as NovelAIStudioGenerateRequest['sampler'] }
        : {}),
      ...(values.scale !== undefined && values.scale >= 0 && values.scale <= 10
        ? { scale: values.scale }
        : {}),
      ...(values.seed !== undefined &&
      values.seed >= -1 &&
      values.seed <= 2147483647
        ? { seed: values.seed }
        : {}),
    })
    setPromptMode(
      /^\s*fur dataset\s*,/i.test(values.prompt ?? '') ? 'furry' : 'anime',
    )
    saveDraft()
    if (unsupported)
      message.info(t('部分来源参数不受 NovelAI 支持，已保留当前值'))
  }, [form, incomingParameters])

  useEffect(() => {
    if (!incomingPreset) return
    const { provider, values } = incomingPreset.preset
    const patch: Partial<NovelAIStudioGenerateRequest> = {}
    const skipped: string[] = []
    if (values.prompt !== undefined) patch.prompt = values.prompt
    if (values.negativePrompt !== undefined)
      patch.negativePrompt = values.negativePrompt
    if (provider === 'novelai') {
      if (
        typeof values.model === 'string' &&
        NOVELAI_IMAGE_MODELS.some((entry) => entry.id === values.model)
      )
        patch.model = values.model
      if (values.characters) patch.characters = values.characters
      if (
        values.qualityPreset === 'none' ||
        values.qualityPreset === 'light' ||
        values.qualityPreset === 'standard'
      )
        patch.qualityPreset = values.qualityPreset
      if (values.qualityToggle !== undefined)
        patch.qualityToggle = values.qualityToggle
      if (
        values.cfgRescale !== undefined &&
        values.cfgRescale >= 0 &&
        values.cfgRescale <= 1
      )
        patch.cfgRescale = values.cfgRescale
    } else if (values.model) skipped.push(t('模型'))
    const validSize = (value: number | undefined) =>
      value !== undefined && value >= 64 && value <= 2048 && value % 64 === 0
    if (validSize(values.width)) patch.width = values.width
    else if (values.width !== undefined) skipped.push(t('宽度'))
    if (validSize(values.height)) patch.height = values.height
    else if (values.height !== undefined) skipped.push(t('高度'))
    if (values.steps !== undefined && values.steps >= 1 && values.steps <= 50)
      patch.steps = values.steps
    else if (values.steps !== undefined) skipped.push(t('步数'))
    if (
      values.seed !== undefined &&
      values.seed >= -1 &&
      values.seed <= 2147483647
    )
      patch.seed = values.seed
    else if (values.seed !== undefined) skipped.push(t('种子'))
    if (
      values.sampler &&
      NOVELAI_SAMPLERS.includes(
        values.sampler as NovelAIStudioGenerateRequest['sampler'],
      )
    )
      patch.sampler = values.sampler as NovelAIStudioGenerateRequest['sampler']
    else if (values.sampler) skipped.push(t('采样器'))
    if (
      values.schedule &&
      NOVELAI_NOISE_SCHEDULES.includes(
        values.schedule as NovelAIStudioGenerateRequest['noiseSchedule'],
      )
    )
      patch.noiseSchedule =
        values.schedule as NovelAIStudioGenerateRequest['noiseSchedule']
    else if (values.schedule) skipped.push(t('调度'))
    if (provider === 'civitai' && values.characters?.length)
      skipped.push(t('角色提示词'))
    if (values.scale !== undefined && values.scale >= 0 && values.scale <= 10)
      patch.scale = values.scale
    else if (values.scale !== undefined) skipped.push('CFG')
    form.setFieldsValue(patch)
    if (patch.model !== undefined) clearUnsupportedPreciseReference(patch.model)
    if (patch.prompt !== undefined) {
      const nextMode =
        provider === 'novelai' &&
        (values.promptMode === 'anime' || values.promptMode === 'furry')
          ? values.promptMode
          : /^\s*fur dataset\s*,/i.test(patch.prompt)
            ? 'furry'
            : 'anime'
      setPromptMode(nextMode)
      try {
        window.localStorage.setItem('studio-novelai-prompt-mode', nextMode)
      } catch {
        /* 存储不可用 */
      }
    }
    saveDraft()
    const summary = t('{0}预设「{1}」{2}', [
      Object.keys(patch).length ? t('已套用') : t('没有可套用参数'),
      incomingPreset.preset.name,
      skipped.length ? `；跳过 ${skipped.join('、')}` : '',
    ])
    if (Object.keys(patch).length) message.success(summary)
    else message.info(summary)
  }, [form, incomingPreset])

  function capturePreset() {
    const current = form.getFieldsValue(true) as NovelAIStudioGenerateRequest
    const values: PresetValues = {
      model: current.model,
      prompt: current.prompt,
      promptMode,
      negativePrompt: current.negativePrompt,
      characters: current.characters,
      width: current.width,
      height: current.height,
      steps: current.steps,
      seed: current.seed,
      sampler: current.sampler,
      schedule: current.noiseSchedule,
      scale: current.scale,
      cfgRescale: current.cfgRescale,
      qualityPreset: current.qualityPreset,
      qualityToggle: current.qualityToggle,
    }
    const defaults = { ...INITIAL_VALUES, model: settings.model }
    const suggested = PRESET_FIELDS.filter(
      (field) =>
        touchedPresetFields.current.has(field.key) ||
        field.keys.some((key) => {
          const actual = values[key]
          const original =
            key === 'promptMode'
              ? 'anime'
              : key === 'schedule'
                ? defaults.noiseSchedule
                : defaults[key as keyof NovelAIStudioGenerateRequest]
          return (
            actual !== undefined &&
            JSON.stringify(actual) !== JSON.stringify(original)
          )
        }),
    ).map((field) => field.key)
    return { values, suggested }
  }

  useEffect(() => {
    if (incomingReference) selectStudioReference(incomingReference.itemId)
  }, [incomingReference])

  function clearReferenceImage() {
    setReferenceImage(null)
    form.setFieldValue('referenceImageUrl', undefined)
    form.setFieldValue('action', 'generate')
    setMaskDataUrl(undefined)
    setViewSource(false)
    saveDraft(undefined)
  }

  function saveDraft(mask = maskDataUrl) {
    try {
      window.localStorage.setItem(
        'studio-novelai-draft-v1',
        JSON.stringify({ ...form.getFieldsValue(true), maskImageUrl: mask }),
      )
    } catch {
      /* 浏览器禁用存储 */
    }
  }

  function clearUnsupportedPreciseReference(nextModel: string) {
    if (!nextModel.startsWith('nai-diffusion-4-5-'))
      form.setFieldValue(['preciseReference', 'imageUrl'], undefined)
  }

  async function stageReferenceImage(
    source: Pick<SelectedReferenceImage, 'name' | 'source' | 'sourceId'>,
    load: () => Promise<string>,
  ) {
    if (referenceLoading) return
    setReferenceLoading(true)
    try {
      const url = await load()
      const sourceSize = await readImageSize(url)
      const targetSize = calculateNovelAIImg2ImgSize(
        sourceSize.width,
        sourceSize.height,
      )
      setReferenceImage({
        ...source,
        url,
        sourceWidth: sourceSize.width,
        sourceHeight: sourceSize.height,
        targetWidth: targetSize.width,
        targetHeight: targetSize.height,
      })
      form.setFieldsValue({
        referenceImageUrl: url,
        action:
          form.getFieldValue('action') === 'infill' ? 'infill' : 'img2img',
        width: targetSize.width,
        height: targetSize.height,
      })
      setMaskDataUrl(undefined)
      setViewSource(true)
      saveDraft(undefined)
      message.success(
        t('已按参考图比例设为 {0}×{1}', [targetSize.width, targetSize.height]),
      )
    } catch (error) {
      message.error(
        error instanceof Error ? t(error.message) : t('参考图处理失败'),
      )
    } finally {
      setReferenceLoading(false)
    }
  }

  function selectStudioReference(itemId: string) {
    const item = items.find((entry) => entry.id === itemId)
    if (!item || item.format === 'psd') return
    void stageReferenceImage(
      { name: item.name, source: '暂存台', sourceId: item.id },
      () =>
        uploadInputImageFromUrl(studioFileUrl(item.id), {
          maxDimension: NOVELAI_REFERENCE_MAX_DIMENSION,
        }),
    )
  }

  function selectGalleryReference() {
    openGallery({
      maxCount: 1,
      onSelect: (images) => {
        const image = images[0]
        if (!image) return
        const name =
          image.url.split('/').pop()?.split(/[?#]/, 1)[0] || t('图库图片')
        void stageReferenceImage({ name, source: '图库' }, () =>
          uploadInputImageFromUrl(image.url, {
            maxDimension: NOVELAI_REFERENCE_MAX_DIMENSION,
          }),
        )
      },
    })
  }

  async function uploadReferenceFile(file: File) {
    if (file.size > NOVELAI_REFERENCE_MAX_BYTES) {
      message.error(t('参考图不能超过 16 MiB'))
      return false
    }
    await stageReferenceImage(
      { name: file.name, source: '上传文件' },
      async () => {
        const image = await imageBlobToUploadDataUrl(file)
        return uploadInputImageBase64(image, {
          maxDimension: NOVELAI_REFERENCE_MAX_DIMENSION,
        })
      },
    )
    return false
  }

  function closeOptimize() {
    optimizeRequestId.current++
    optimizeImageId.current++
    setOptimizeOpen(false)
    setOptimizeImage(null)
    setOptimizeLoading(false)
  }

  async function setOptimizeReference(name: string, load: () => Promise<Blob>) {
    const imageId = ++optimizeImageId.current
    try {
      const blob = await load()
      if (blob.size > NOVELAI_REFERENCE_MAX_BYTES)
        throw new Error(t('参考图不能超过 16 MiB'))
      const url = await imageBlobToUploadDataUrl(blob)
      if (imageId === optimizeImageId.current) setOptimizeImage({ name, url })
    } catch (error) {
      if (imageId === optimizeImageId.current)
        message.error(
          error instanceof Error ? t(error.message) : t('优化参考图读取失败'),
        )
    }
  }

  function selectOptimizeGalleryImage() {
    openGallery({
      maxCount: 1,
      onSelect: (images) => {
        const image = images[0]
        if (!image) return
        void setOptimizeReference(t('图库参考图'), async () => {
          const response = await fetch(image.url)
          if (!response.ok) throw new Error(t('图库参考图读取失败'))
          return response.blob()
        })
      },
    })
  }

  async function optimizePrompt() {
    if (!optimizeText.trim() && !optimizeImage) {
      message.warning(t('请填写提示词或添加参考图'))
      return
    }
    const endpointId =
      llmEndpoints.find((endpoint) => endpoint.id === optimizeEndpointId)?.id ||
      llmEndpoints[0]?.id
    if (!endpointId) {
      openSettingModal({ initialTab: 'llm-endpoints' })
      return
    }
    if (!optimizeEndpointId) setOptimizeEndpointId(endpointId)
    const requestId = ++optimizeRequestId.current
    setOptimizeLoading(true)
    try {
      const content: ChatContentPart[] = []
      if (optimizeText.trim())
        content.push({ type: 'text', text: optimizeText.trim() })
      if (optimizeImage)
        content.push({
          type: 'image_url',
          image_url: { url: optimizeImage.url },
        })
      const inpaint = form.getFieldValue('action') === 'infill'
      const systemPrompt = inpaint
        ? promptMode === 'furry'
          ? llmPrompts.novelaiInpaintFurryPrompt
          : llmPrompts.novelaiInpaintAnimePrompt
        : promptMode === 'furry'
          ? llmPrompts.novelaiFurryPrompt
          : llmPrompts.novelaiAnimePrompt
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ]
      const result = await requestChatCompletion({ endpointId, messages })
      if (requestId === optimizeRequestId.current) {
        if (!result.trim()) throw new Error(t('优化结果为空'))
        setOptimizeText(result)
      }
    } catch (error) {
      if (requestId === optimizeRequestId.current)
        message.error(
          error instanceof Error ? t(error.message) : t('提示词优化失败'),
        )
    } finally {
      if (requestId === optimizeRequestId.current) setOptimizeLoading(false)
    }
  }

  function adoptOptimizedPrompt() {
    const parsed = parseNovelAIOptimizedPrompt(optimizeText)
    if (!parsed.prompt && !parsed.uc && !parsed.characters.length) {
      message.warning(t('没有可采纳的提示词内容'))
      return
    }
    const existing = form.getFieldValue('characters') || []
    form.setFieldsValue({
      ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
      ...(parsed.uc ? { negativePrompt: parsed.uc } : {}),
      ...(parsed.characters.length
        ? {
            characters: parsed.characters.map((prompt, index) => ({
              ...existing[index],
              prompt,
              negativePrompt: existing[index]?.negativePrompt || '',
            })),
          }
        : {}),
    })
    saveDraft()
    closeOptimize()
  }

  async function generate() {
    if (!settings.configured) {
      message.warning(t('请先保存 NovelAI API Token'))
      return
    }
    await form.validateFields()
    const values = form.getFieldsValue(true) as NovelAIStudioGenerateRequest
    if (values.action === 'img2img' && !values.referenceImageUrl) {
      message.warning(t('图生图需要参考图'))
      return
    }
    if (
      values.action === 'infill' &&
      (!values.referenceImageUrl || !maskDataUrl)
    ) {
      message.warning(t('局部重绘需要参考图和涂抹区域'))
      return
    }
    if (
      values.action === 'infill' &&
      values.model !== 'nai-diffusion-5-full' &&
      !values.model.startsWith('nai-diffusion-4')
    ) {
      message.warning(t('当前模型不支持局部重绘，请选择 V5 Full 或 V4/V4.5'))
      return
    }
    if (
      values.preciseReference?.imageUrl &&
      !values.model.startsWith('nai-diffusion-4-5-')
    ) {
      message.warning(t('精密参考仅支持 V4.5 模型'))
      return
    }
    setGenerating(true)
    try {
      const maskImageUrl =
        values.action === 'infill' && maskDataUrl?.startsWith('data:')
          ? (await uploadNovelAIMask(maskDataUrl)).url
          : values.action === 'infill'
            ? maskDataUrl
            : undefined
      const { preciseReference, ...plainValues } = values
      const characters = (values.characters || []).map((character, index) => {
        const { position, ...rest } = character
        if ((position?.x == null) !== (position?.y == null))
          throw new Error(t('角色 {0} 的横向和纵向位置需同时填写', [index + 1]))
        return position?.x == null ? rest : { ...rest, position }
      })
      const result = await generateNovelAIStudioImages({
        ...plainValues,
        characters,
        prompt:
          promptMode === 'furry'
            ? /\bfur dataset\b/i.test(values.prompt)
              ? values.prompt
              : `fur dataset, ${values.prompt}`
            : values.prompt,
        referenceImageUrl:
          values.action === 'generate' ? undefined : values.referenceImageUrl,
        ...(preciseReference?.imageUrl ? { preciseReference } : {}),
        maskImageUrl,
        saveToTaskList: gptImageSettings.autoSaveStudioTasksToTaskList ?? false,
      })
      onItems([...result.items, ...(result.rawItems || [])])
      if (result.warning) message.warning(result.warning)
      setViewSource(false)
      if (result.items[0]) {
        onSelectItem(result.items[0].id)
        onMobilePanel('canvas')
      }
      message.success(
        t('NovelAI 已生成 {0} 张图片{1}', [
          result.items.length,
          result.rawItems?.length
            ? `，另存 ${result.rawItems.length} 张上游原始结果`
            : '',
        ]),
      )
      window.dispatchEvent(
        new CustomEvent('studio-balance-changed', { detail: 'novelai' }),
      )
    } catch (error) {
      message.error(
        error instanceof Error ? t(error.message) : t('NovelAI 生成失败'),
      )
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className={`studio-novelai-workbench is-mobile-${mobilePanel}`}>
      <aside className="studio-novelai-parameters">
        <header className="studio-novelai-parameters-header">
          <strong>{t('生成参数')}</strong>
          <span>GENERATION</span>
        </header>
        <div className="studio-novelai-parameters-scroll">
          <div className="studio-provider-panel">
            <Collapse
              size="small"
              items={[
                {
                  key: 'key',
                  label: t('NovelAI 连接 · {0}', [
                    settings.configured ? t('已设置') : t('未设置'),
                  ]),
                  children: (
                    <ProviderKeyCard
                      provider="NovelAI"
                      configured={settings.configured}
                      keyHint={settings.keyHint}
                      onSave={async (apiKey) =>
                        onSettings(await updateNovelAISettings({ apiKey }))
                      }
                      onClear={async () =>
                        onSettings(
                          await updateNovelAISettings({ clearApiKey: true }),
                        )
                      }
                      onTest={async () => {
                        const status = await testStudioProvider('novelai')
                        return status.anlas === undefined
                          ? undefined
                          : t('Anlas 余额 {0}', [status.anlas])
                      }}
                    />
                  ),
                },
              ]}
            />
            <Form
              form={form}
              layout="vertical"
              initialValues={{ ...INITIAL_VALUES, model: settings.model }}
              className="studio-generation-form"
              onValuesChange={(
                changed: Partial<NovelAIStudioGenerateRequest>,
              ) => {
                for (const field of PRESET_FIELDS)
                  if (
                    field.keys.some((key) =>
                      key === 'schedule'
                        ? changed.noiseSchedule !== undefined
                        : changed[key as keyof NovelAIStudioGenerateRequest] !==
                          undefined,
                    )
                  )
                    touchedPresetFields.current.add(field.key)
                if (changed.inpaintFeatherPixels !== undefined) {
                  const edge = form.getFieldValue(
                    'inpaintEdgeFeatherPixels',
                  ) as number | undefined
                  if (edge !== undefined && edge > changed.inpaintFeatherPixels)
                    form.setFieldValue(
                      'inpaintEdgeFeatherPixels',
                      changed.inpaintFeatherPixels,
                    )
                }
                saveDraft()
              }}
            >
              <Form.Item label={t('生成模式')} name="action">
                <Segmented
                  block
                  options={[
                    { label: t('文生图'), value: 'generate' },
                    { label: t('图生图'), value: 'img2img' },
                    { label: t('局部重绘'), value: 'infill' },
                  ]}
                  onChange={(value) => {
                    if (value !== 'infill') {
                      setMaskDataUrl(undefined)
                      saveDraft(undefined)
                    }
                    onMobilePanel('canvas')
                  }}
                />
              </Form.Item>
              <div className="studio-form-grid studio-form-grid-wide">
                <Form.Item label={t('任务名称')} name="title">
                  <Input maxLength={120} placeholder="NovelAI Studio" />
                </Form.Item>
                <Form.Item
                  label={t('模型')}
                  name="model"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={NOVELAI_IMAGE_MODELS.map((model) => ({
                      label: model.name.replace(/^NovelAI Diffusion /, ''),
                      value: model.id,
                    }))}
                    onChange={(model) => {
                      clearUnsupportedPreciseReference(model)
                      saveDraft()
                      void updateNovelAISettings({ model })
                        .then(onSettings)
                        .catch((error) =>
                          message.error(
                            error instanceof Error
                              ? t(error.message)
                              : t('默认模型保存失败'),
                          ),
                        )
                    }}
                  />
                </Form.Item>
              </div>
              <div className="studio-section-heading">
                <div>
                  <strong>{t('提示词模式')}</strong>
                  <small>
                    {t(
                      'Furry 模式自动补齐 fur dataset 标签；Anime 模式保留原文',
                    )}
                  </small>
                </div>
                <Segmented
                  value={promptMode}
                  options={[
                    { label: 'Anime', value: 'anime' },
                    { label: 'Furry', value: 'furry' },
                  ]}
                  onChange={(value) => {
                    setPromptMode(value as 'anime' | 'furry')
                    try {
                      window.localStorage.setItem(
                        'studio-novelai-prompt-mode',
                        value,
                      )
                    } catch {
                      /* 存储不可用 */
                    }
                  }}
                />
              </div>
              <Button
                icon={<BulbOutlined />}
                onClick={() => {
                  optimizeImageId.current++
                  setOptimizeText(form.getFieldValue('prompt') || '')
                  const referenceUrl =
                    form.getFieldValue('action') !== 'generate'
                      ? (form.getFieldValue('referenceImageUrl') as
                          | string
                          | undefined)
                      : undefined
                  setOptimizeImage(
                    referenceUrl
                      ? {
                          name:
                            referenceImage?.url === referenceUrl
                              ? referenceImage.name
                              : t('生图参考图'),
                          url: referenceUrl,
                          automatic: true,
                        }
                      : null,
                  )
                  setOptimizeOpen(true)
                }}
              >
                {t('提示词优化')}
              </Button>
              <Form.Item
                label={t('提示词')}
                name="prompt"
                rules={[{ required: true, message: t('请输入提示词') }]}
              >
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} />
              </Form.Item>
              <Form.Item label="UC（Undesired Content）" name="negativePrompt">
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 8 }}
                  placeholder={t('不希望出现在画面中的内容')}
                />
              </Form.Item>
              {action !== 'generate' && (
                <div
                  className="studio-reference-section"
                  onDragOver={(event) => {
                    if (
                      !event.dataTransfer.types.includes(
                        'application/x-linai-studio',
                      )
                    )
                      return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                  }}
                  onDrop={(event) => {
                    const itemId = event.dataTransfer.getData(
                      'application/x-linai-studio',
                    )
                    if (!itemId) return
                    event.preventDefault()
                    selectStudioReference(itemId)
                  }}
                >
                  <div className="studio-section-heading">
                    <div>
                      <strong>{t('图生图参考图')}</strong>
                      <small>
                        {t('拖入暂存台图片，或选择一张；自动匹配生成尺寸')}
                      </small>
                    </div>
                  </div>
                  <div className="studio-reference-actions">
                    <Select
                      showSearch
                      allowClear
                      optionFilterProp="label"
                      placeholder={t('从暂存台选择')}
                      loading={referenceLoading}
                      disabled={referenceLoading || generating}
                      value={
                        referenceImage?.source === '暂存台'
                          ? referenceImage.sourceId
                          : undefined
                      }
                      options={items.map((item) => ({
                        label: `${item.name} · ${item.format.toUpperCase()}`,
                        value: item.id,
                        disabled: item.format === 'psd',
                      }))}
                      onChange={(itemId) => {
                        if (itemId) selectStudioReference(itemId)
                        else clearReferenceImage()
                      }}
                    />
                    <Button
                      icon={<FolderOpenOutlined />}
                      loading={referenceLoading}
                      disabled={referenceLoading || generating}
                      onClick={selectGalleryReference}
                    >
                      {t('图库')}
                    </Button>
                    <Upload
                      accept={REFERENCE_ACCEPT}
                      maxCount={1}
                      showUploadList={false}
                      beforeUpload={uploadReferenceFile}
                    >
                      <Button
                        icon={<UploadOutlined />}
                        loading={referenceLoading}
                        disabled={referenceLoading || generating}
                      >
                        {t('上传文件')}
                      </Button>
                    </Upload>
                  </div>
                  <Form.Item name="referenceImageUrl" hidden>
                    <Input />
                  </Form.Item>
                  {referenceImage ? (
                    <div className="studio-reference-preview">
                      <img src={referenceImage.url} alt={referenceImage.name} />
                      <div>
                        <strong>{referenceImage.name}</strong>
                        <span>
                          {t('来源：')}
                          {t(referenceImage.source)}
                        </span>
                        <span>
                          {t('参考图')} {referenceImage.sourceWidth}×
                          {referenceImage.sourceHeight} {t('· 自动生成尺寸')}{' '}
                          {referenceImage.targetWidth}×
                          {referenceImage.targetHeight}
                        </span>
                      </div>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('移除参考图')}
                        onClick={clearReferenceImage}
                      />
                    </div>
                  ) : (
                    <div className="studio-reference-empty">
                      <PictureOutlined />
                      <span>{t('从暂存台拖入图片，或在上方选择参考图')}</span>
                    </div>
                  )}
                  <div className="studio-slider-grid">
                    <Form.Item label={t('图像变化强度')} name="strength">
                      <Slider
                        min={0}
                        max={1}
                        step={0.01}
                        disabled={!referenceImage}
                      />
                    </Form.Item>
                    <Form.Item label={t('额外噪声')} name="noise">
                      <Slider
                        min={0}
                        max={1}
                        step={0.01}
                        disabled={!referenceImage}
                      />
                    </Form.Item>
                  </div>
                  {action === 'infill' && (
                    <Alert
                      type="info"
                      showIcon
                      title={t('在中间画布涂抹需要重绘的区域')}
                      description={t(
                        '小范围重绘建议开启聚焦，并让遮罩略宽于目标轮廓；提示词只描述要改的局部。',
                      )}
                    />
                  )}
                  {action === 'infill' && (
                    <>
                      <Form.Item
                        label={t('遮罩内参考图')}
                        name="inpaintBase"
                        extra={t(
                          '模糊仅用于发送给 NovelAI 的参考图；涂抹范围外与最终合成仍使用原图。可固定种子对比效果。',
                        )}
                      >
                        <Select
                          options={[
                            { label: t('保留原图'), value: 'original' },
                            { label: t('模糊涂抹区域'), value: 'blur' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        label={t('聚焦局部重绘')}
                        name="focusedInpaint"
                        valuePropName="checked"
                        extra={t(
                          '放大遮罩附近的画面生成，再按所选方式融合；范围过大时使用整图。',
                        )}
                      >
                        <Switch />
                      </Form.Item>
                      {focusedInpaint && (
                        <Form.Item
                          label={t('蒙版外上下文像素')}
                          name="inpaintContextPixels"
                          extra={t(
                            '保留在遮罩周围供模型参考的原图范围；过小可能失去结构信息。',
                          )}
                        >
                          <Slider min={32} max={512} step={32} />
                        </Form.Item>
                      )}
                      {focusedInpaint && (
                        <Form.Item
                          label={t('边缘融合方式')}
                          name="inpaintBlendMode"
                          extra={
                            inpaintBlendMode === 'soft'
                              ? t(
                                  '蒙版内保持重绘内容；过渡半径决定蒙版外的覆盖范围，羽化半径控制最外缘的柔和宽度。',
                                )
                              : t(
                                  '只在蒙版内侧过渡，蒙版外像素保持不变；小选区会自动缩短宽度，20 和 32 的实际效果可能接近。',
                                )
                          }
                        >
                          <Select
                            options={[
                              { label: t('柔和融合'), value: 'soft' },
                              { label: t('严格保留蒙版外'), value: 'strict' },
                            ]}
                          />
                        </Form.Item>
                      )}
                      {focusedInpaint && (
                        <Form.Item
                          label={
                            inpaintBlendMode === 'soft'
                              ? t('过渡半径（原图像素）')
                              : t('最大内侧过渡像素')
                          }
                          name="inpaintFeatherPixels"
                          extra={
                            inpaintBlendMode === 'soft'
                              ? t(
                                  '重绘内容最多延伸到蒙版外的范围；蒙版内保持不透明。',
                                )
                              : t(
                                  '仅在蒙版内侧衔接边缘，不能修正生成内容内部的差异。',
                                )
                          }
                        >
                          <Slider min={4} max={32} step={4} />
                        </Form.Item>
                      )}
                      {focusedInpaint && inpaintBlendMode === 'soft' && (
                        <Form.Item
                          label={t('羽化半径（原图像素）')}
                          name="inpaintEdgeFeatherPixels"
                          extra={t(
                            '只柔化过渡范围的最外缘；0 为硬边。羽化宽度不超过过渡半径，蒙版内保持实心。',
                          )}
                        >
                          <Slider
                            min={0}
                            max={inpaintTransitionPixels}
                            step={1}
                          />
                        </Form.Item>
                      )}
                      <Form.Item
                        label={t('另存上游原始结果')}
                        name="saveInpaintRaw"
                        valuePropName="checked"
                        extra={t(
                          '额外保存到暂存台，供对照合成前后的变化；聚焦时保存的是放大的局部图。',
                        )}
                      >
                        <Switch />
                      </Form.Item>
                    </>
                  )}
                </div>
              )}
              <Collapse
                ghost
                items={[
                  {
                    key: 'precise',
                    label: t('精密参考（V4.5）'),
                    children: (
                      <>
                        <Alert
                          type="info"
                          showIcon
                          title={t(
                            '可参考人物、画风，或两者一起；与图生图参考图用途不同',
                          )}
                        />
                        <Form.Item
                          label={t('暂存台素材')}
                          name={['preciseReference', 'imageUrl']}
                        >
                          <Select
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder={t('选择精密参考图')}
                            disabled={!model.startsWith('nai-diffusion-4-5-')}
                            options={[
                              ...(preciseImageUrl &&
                              preciseImageUrl.startsWith('/api/')
                                ? [
                                    {
                                      label: t('当前精密参考图'),
                                      value: preciseImageUrl,
                                    },
                                  ]
                                : []),
                              ...items
                                .filter((item) => item.format !== 'psd')
                                .map((item) => ({
                                  label: item.name,
                                  value: studioFileUrl(item.id),
                                })),
                            ]}
                            onChange={(url) => {
                              if (url) {
                                setPreciseLoading(true)
                                void uploadInputImageFromUrl(url, {
                                  maxDimension: 2048,
                                })
                                  .then((inputUrl) => {
                                    form.setFieldValue(
                                      ['preciseReference', 'imageUrl'],
                                      inputUrl,
                                    )
                                    saveDraft()
                                  })
                                  .catch((error) =>
                                    message.error(
                                      error instanceof Error
                                        ? t(error.message)
                                        : t('精密参考上传失败'),
                                    ),
                                  )
                                  .finally(() => setPreciseLoading(false))
                              }
                            }}
                          />
                        </Form.Item>
                        <Upload
                          accept={REFERENCE_ACCEPT}
                          showUploadList={false}
                          beforeUpload={async (file) => {
                            setPreciseLoading(true)
                            try {
                              form.setFieldValue(
                                ['preciseReference', 'imageUrl'],
                                await uploadInputImageBase64(
                                  await imageBlobToUploadDataUrl(file),
                                  { maxDimension: 2048 },
                                ),
                              )
                              saveDraft()
                            } catch (error) {
                              message.error(
                                error instanceof Error
                                  ? t(error.message)
                                  : t('精密参考上传失败'),
                              )
                            } finally {
                              setPreciseLoading(false)
                            }
                            return false
                          }}
                        >
                          <Button
                            loading={preciseLoading}
                            disabled={!model.startsWith('nai-diffusion-4-5-')}
                            icon={<UploadOutlined />}
                          >
                            {t('上传参考图')}
                          </Button>
                        </Upload>
                        <Form.Item
                          label={t('参考类型')}
                          name={['preciseReference', 'type']}
                          initialValue="character"
                        >
                          <Select
                            options={[
                              { label: t('角色外观'), value: 'character' },
                              { label: t('画风'), value: 'style' },
                              {
                                label: t('角色与画风'),
                                value: 'character-and-style',
                              },
                            ]}
                          />
                        </Form.Item>
                        <Form.Item
                          label={t('参考强度')}
                          name={['preciseReference', 'strength']}
                          initialValue={0.7}
                        >
                          <Slider min={0} max={1} step={0.01} />
                        </Form.Item>
                        <Form.Item
                          label={t('忠实度')}
                          name={['preciseReference', 'fidelity']}
                          initialValue={0.7}
                        >
                          <Slider min={0} max={1} step={0.01} />
                        </Form.Item>
                      </>
                    ),
                  },
                ]}
              />
              <Form.List name="characters">
                {(fields, { add, remove }) => (
                  <div className="studio-character-list">
                    <div className="studio-section-heading">
                      <div>
                        <strong>{t('角色提示词')}</strong>
                        <small>
                          {t('V4/V5 将每个角色独立送入 Character Prompt')}
                        </small>
                      </div>
                      <Button icon={<PlusOutlined />} onClick={() => add()}>
                        {t('添加角色')}
                      </Button>
                    </div>
                    {fields.map((field, index) => (
                      <div className="studio-character-card" key={field.key}>
                        <div className="studio-character-title">
                          <strong>
                            {t('角色')} {index + 1}
                          </strong>
                          <Space size={4}>
                            <NovelAICharacterImagePrompt
                              mode={promptMode}
                              onAdopt={(prompt, uc) => {
                                touchedPresetFields.current.add('characters')
                                const characters =
                                  form.getFieldValue('characters') || []
                                form.setFieldValue(['characters', field.name], {
                                  ...characters[field.name],
                                  prompt,
                                  negativePrompt: uc,
                                })
                                saveDraft()
                              }}
                            />
                            <Button
                              danger
                              type="text"
                              icon={<MinusCircleOutlined />}
                              onClick={() => remove(field.name)}
                            />
                          </Space>
                        </div>
                        <Form.Item
                          label={t('角色提示词')}
                          name={[field.name, 'prompt']}
                          rules={[
                            { required: true, message: t('请输入角色提示词') },
                          ]}
                        >
                          <Input.TextArea
                            autoSize={{ minRows: 2, maxRows: 6 }}
                          />
                        </Form.Item>
                        <Form.Item
                          label={t('角色 UC')}
                          name={[field.name, 'negativePrompt']}
                        >
                          <Input.TextArea
                            autoSize={{ minRows: 1, maxRows: 4 }}
                          />
                        </Form.Item>
                        <div className="studio-form-grid studio-form-grid-wide">
                          <Form.Item
                            label={t('横向位置（0–1）')}
                            name={[field.name, 'position', 'x']}
                          >
                            <InputNumber min={0} max={1} step={0.05} />
                          </Form.Item>
                          <Form.Item
                            label={t('纵向位置（0–1）')}
                            name={[field.name, 'position', 'y']}
                          >
                            <InputNumber min={0} max={1} step={0.05} />
                          </Form.Item>
                        </div>
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
                    label: t('高级生成参数'),
                    children: (
                      <>
                        <div className="studio-form-grid">
                          <Form.Item label={t('宽度')} name="width">
                            <InputNumber min={64} max={2048} step={64} />
                          </Form.Item>
                          <Form.Item label={t('高度')} name="height">
                            <InputNumber min={64} max={2048} step={64} />
                          </Form.Item>
                          <Form.Item label={t('步数')} name="steps">
                            <InputNumber min={1} max={50} />
                          </Form.Item>
                          <Form.Item label={t('种子（-1 为随机）')} name="seed">
                            <InputNumber min={-1} max={2147483647} />
                          </Form.Item>
                          <Form.Item label={t('采样器')} name="sampler">
                            <Select
                              options={NOVELAI_SAMPLERS.map((value) => ({
                                label: value,
                                value,
                              }))}
                            />
                          </Form.Item>
                          <Form.Item label={t('噪声调度')} name="noiseSchedule">
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
                          <Form.Item label={t('生成张数')} name="n">
                            <InputNumber min={1} max={4} />
                          </Form.Item>
                          {!model.startsWith('nai-diffusion-5-') && (
                            <Form.Item
                              label={t('自动质量标签')}
                              name="qualityToggle"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          )}
                        </Space>
                        {model.startsWith('nai-diffusion-5-') && (
                          <Form.Item label={t('画质标签')} name="qualityPreset">
                            <Select
                              options={[
                                { label: t('关闭'), value: 'none' },
                                { label: 'Light', value: 'light' },
                                { label: 'Standard', value: 'standard' },
                              ]}
                            />
                          </Form.Item>
                        )}
                        <Form.Item label={t('UC 预设')} name="ucPreset">
                          <Select
                            options={[
                              { label: 'Heavy', value: 0 },
                              { label: 'Light', value: 1 },
                              {
                                label: 'Furry Focus',
                                value: 2,
                                disabled: model === 'nai-diffusion-4-5-curated',
                              },
                              { label: 'Human Focus', value: 3 },
                              { label: t('关闭'), value: 4 },
                            ]}
                          />
                        </Form.Item>
                      </>
                    ),
                  },
                ]}
              />
            </Form>
            <Modal
              title={t('NovelAI {0} {1}提示词优化', [
                promptMode === 'furry' ? 'Furry' : 'Anime',
                action === 'infill' ? t('局部重绘') : t('文生图/图生图'),
              ])}
              open={optimizeOpen}
              onCancel={closeOptimize}
              onOk={adoptOptimizedPrompt}
              okText={t('采纳')}
              cancelText={t('丢弃')}
              okButtonProps={{
                disabled: optimizeLoading || !optimizeText.trim(),
              }}
              width={680}
              destroyOnHidden
            >
              <Input.TextArea
                value={optimizeText}
                onChange={(event) => setOptimizeText(event.target.value)}
                autoSize={{ minRows: 8, maxRows: 18 }}
                placeholder={t('填写提示词或描述；优化结果会显示在这里')}
              />
              <Space wrap style={{ marginTop: 12 }}>
                <Upload
                  accept={REFERENCE_ACCEPT}
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void setOptimizeReference(file.name, async () => file)
                    return false
                  }}
                >
                  <Button icon={<UploadOutlined />}>{t('上传图片')}</Button>
                </Upload>
                <Button
                  icon={<PictureOutlined />}
                  onClick={selectOptimizeGalleryImage}
                >
                  {t('图库')}
                </Button>
                {optimizeImage && (
                  <>
                    <img
                      src={optimizeImage.url}
                      alt={optimizeImage.name}
                      style={{ width: 48, height: 48, objectFit: 'cover' }}
                    />
                    <span>
                      {optimizeImage.automatic ? t('自动带入：') : ''}
                      {optimizeImage.name}
                    </span>
                    <Button
                      size="small"
                      onClick={() => {
                        optimizeImageId.current++
                        setOptimizeImage(null)
                      }}
                    >
                      {t('移除')}
                    </Button>
                  </>
                )}
              </Space>
              <div style={{ marginTop: 12 }}>
                <Button
                  type="primary"
                  loading={optimizeLoading}
                  onClick={() => void optimizePrompt()}
                >
                  {t('优化')}
                </Button>
              </div>
              <div style={{ marginTop: 8, color: '#94a3b8' }}>
                {action === 'infill'
                  ? t(
                      '默认带入未标遮罩的参考原图；如手动换图，则发送换后的图。请在文字中说明要重绘的局部和目标内容。',
                    )
                  : t(
                      '参考图仅发送给提示词优化端点；采纳时分别填入提示词、UC 和角色提示词。',
                    )}
              </div>
            </Modal>
          </div>
        </div>
        <div className="studio-novelai-generate">
          <PresetSaveButton
            provider="novelai"
            mode={action}
            capture={capturePreset}
            onSave={onSavePreset}
          />
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            loading={generating}
            disabled={!settings.configured}
            onClick={() => void generate()}
          >
            {t('生成到暂存台')}
          </Button>
        </div>
      </aside>
      <div className="studio-novelai-stage">
        <NovelAICanvas
          imageUrl={canvasImage}
          name={
            action === 'infill'
              ? referenceImage?.name
              : selectedItem?.name || referenceImage?.name
          }
          width={action === 'infill' ? targetWidth : undefined}
          height={action === 'infill' ? targetHeight : undefined}
          mode={action === 'infill' ? 'mask' : 'view'}
          maskDataUrl={maskDataUrl}
          onMaskChange={(value) => {
            setMaskDataUrl(value)
            saveDraft(value)
          }}
          generating={generating}
          actions={
            <>
              {referenceImage && action !== 'infill' && (
                <Button
                  size="small"
                  onClick={() => setViewSource((value) => !value)}
                >
                  {viewSource ? t('查看结果') : t('查看参考图')}
                </Button>
              )}
              {selectedItem && selectedItem.format !== 'psd' && (
                <Button
                  size="small"
                  onClick={() => {
                    void stageReferenceImage(
                      {
                        name: selectedItem.name,
                        source: '暂存台',
                        sourceId: selectedItem.id,
                      },
                      () =>
                        uploadInputImageFromUrl(
                          studioFileUrl(selectedItem.id),
                          { maxDimension: 2048 },
                        ),
                    )
                    onMobilePanel('parameters')
                  }}
                >
                  {t('用作图生图')}
                </Button>
              )}
              {selectedItem && (
                <Button
                  size="small"
                  onClick={() => onOpenPhotopea(selectedItem)}
                >
                  {t('在 Photopea 打开')}
                </Button>
              )}
            </>
          }
          emptyActions={
            <Button onClick={() => onMobilePanel('parameters')}>
              {t('设置生成参数')}
            </Button>
          }
        />
      </div>
    </div>
  )
}
