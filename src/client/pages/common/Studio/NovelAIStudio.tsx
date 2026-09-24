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
  Modal,
  Select,
  Slider,
  Space,
  Switch,
  Upload,
  Segmented,
  message,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import {
  studioFileUrl,
  type StudioItem,
} from '../../../../shared/studio'
import {
  calculateNovelAIImg2ImgSize,
  NOVELAI_IMAGE_MODELS,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
  type NovelAIStudioGenerateRequest,
  type StudioProviderSettings,
} from '../../../../shared/studio-generation'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { requestChatCompletion, type ChatContentPart, type ChatMessage } from '../../../hooks/useChatCompletion'
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
  uploadNovelAIMask,
  updateNovelAISettings,
} from './api'
import { ProviderKeyCard } from './ProviderKeyCard'
import { NovelAICanvas } from './NovelAICanvas'
import { NovelAICharacterImagePrompt } from './NovelAICharacterImagePrompt'
import type { StudioGenerationParameters } from './studio-parameters'
import { parseNovelAIOptimizedPrompt } from './novelai-prompt'

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
  focusedInpaint: true,
  inpaintContextPixels: 128,
  inpaintFeatherPixels: 20,
  inpaintBlendMode: 'soft',
  saveInpaintRaw: false,
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
    image.onerror = () => reject(new Error('无法读取参考图尺寸'))
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
  onOpenPhotopea: (item: StudioItem) => void
}) {
  const [form] = Form.useForm<NovelAIStudioGenerateRequest>()
  const [generating, setGenerating] = useState(false)
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [referenceImage, setReferenceImage] =
    useState<SelectedReferenceImage | null>(null)
  const [maskDataUrl, setMaskDataUrl] = useState<string>()
  const [recentResults, setRecentResults] = useState<StudioItem[]>([])
  const [viewSource, setViewSource] = useState(false)
  const [preciseLoading, setPreciseLoading] = useState(false)
  const [promptMode, setPromptMode] = useState<'anime' | 'furry'>(() => {
    try { return window.localStorage.getItem('studio-novelai-prompt-mode') === 'furry' ? 'furry' : 'anime' }
    catch { return 'anime' }
  })
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [optimizeText, setOptimizeText] = useState('')
  const [optimizeImage, setOptimizeImage] = useState<{ name: string; url: string; automatic?: boolean } | null>(null)
  const [optimizeLoading, setOptimizeLoading] = useState(false)
  const optimizeRequestId = useRef(0)
  const optimizeImageId = useRef(0)
  const { gptImageSettings, optimizeEndpointId, setOptimizeEndpointId } = useLocalSetting()
  const { llmEndpoints, llmPrompts } = useGlobalStore()
  const model = Form.useWatch('model', form) || settings.model
  const action = Form.useWatch('action', form) || 'generate'
  const focusedInpaint = Form.useWatch('focusedInpaint', form) ?? true
  const inpaintBlendMode = Form.useWatch('inpaintBlendMode', form) ?? INITIAL_VALUES.inpaintBlendMode
  const targetWidth = Form.useWatch('width', { form, preserve: true }) || 1024
  const targetHeight = Form.useWatch('height', { form, preserve: true }) || 1024
  const preciseImageUrl = Form.useWatch(['preciseReference', 'imageUrl'], form)
  const selectedItem = items.find((item) => item.id === selectedItemId)
  const canvasImage = action === 'infill' || (viewSource && referenceImage)
    ? referenceImage?.url
    : selectedItem && selectedItem.format !== 'psd'
      ? studioFileUrl(selectedItem.id)
      : referenceImage?.url

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('studio-novelai-draft-v1')
      if (!saved) return
      const draft = JSON.parse(saved) as NovelAIStudioGenerateRequest
      form.setFieldsValue({ ...INITIAL_VALUES, ...draft, inpaintBlendMode: draft.inpaintBlendMode ?? 'strict' })
      setMaskDataUrl(draft.maskImageUrl)
      if (draft.referenceImageUrl) {
        void readImageSize(draft.referenceImageUrl).then((size) =>
          setReferenceImage({
            url: draft.referenceImageUrl!, name: '上次的参考图', source: '图库',
            sourceWidth: size.width, sourceHeight: size.height,
            targetWidth: draft.width, targetHeight: draft.height,
          }),
        ).catch(() => form.setFieldValue('referenceImageUrl', undefined))
      }
    } catch { /* 私密模式或旧草稿损坏时仍可正常打开 */ }
  }, [form])

  useEffect(() => {
    if (!incomingRequest) return
    const request = incomingRequest.request
    form.setFieldsValue({ ...INITIAL_VALUES, ...request, inpaintBlendMode: request.inpaintBlendMode ?? 'strict' })
    setPromptMode(/^\s*fur dataset\s*,/i.test(request.prompt) ? 'furry' : 'anime')
    setMaskDataUrl(request.maskImageUrl)
    try { window.localStorage.setItem('studio-novelai-draft-v1', JSON.stringify(request)) }
    catch { /* 浏览器禁用存储 */ }
    setViewSource(Boolean(request.referenceImageUrl))
    if (request.referenceImageUrl) {
      void readImageSize(request.referenceImageUrl).then((size) =>
        setReferenceImage({
          url: request.referenceImageUrl!, name: request.title || '参考图', source: '图库',
          sourceWidth: size.width, sourceHeight: size.height,
          targetWidth: request.width, targetHeight: request.height,
        }),
      ).catch(() => setReferenceImage(null))
    } else setReferenceImage(null)
  }, [form, incomingRequest])

  useEffect(() => {
    if (!incomingParameters) return
    const values = incomingParameters.values
    const validSize = (value: number | undefined) => value !== undefined && value >= 64 && value <= 2048 && value % 64 === 0
    const unsupported = (values.width !== undefined && !validSize(values.width))
      || (values.height !== undefined && !validSize(values.height))
      || (values.steps !== undefined && (values.steps < 1 || values.steps > 50))
      || (values.scale !== undefined && (values.scale < 0 || values.scale > 10))
      || (values.seed !== undefined && (values.seed < -1 || values.seed > 2147483647))
      || (values.sampler !== undefined && !NOVELAI_SAMPLERS.includes(values.sampler as NovelAIStudioGenerateRequest['sampler']))
    form.setFieldsValue({
      prompt: values.prompt ?? '',
      negativePrompt: values.negativePrompt ?? '',
      ...(validSize(values.width) ? { width: values.width } : {}),
      ...(validSize(values.height) ? { height: values.height } : {}),
      ...(values.steps !== undefined && values.steps >= 1 && values.steps <= 50 ? { steps: values.steps } : {}),
      ...(values.sampler && NOVELAI_SAMPLERS.includes(values.sampler as NovelAIStudioGenerateRequest['sampler'])
        ? { sampler: values.sampler as NovelAIStudioGenerateRequest['sampler'] } : {}),
      ...(values.scale !== undefined && values.scale >= 0 && values.scale <= 10 ? { scale: values.scale } : {}),
      ...(values.seed !== undefined && values.seed >= -1 && values.seed <= 2147483647 ? { seed: values.seed } : {}),
    })
    setPromptMode(/^\s*fur dataset\s*,/i.test(values.prompt ?? '') ? 'furry' : 'anime')
    saveDraft()
    if (unsupported) message.info('部分来源参数不受 NovelAI 支持，已保留当前值')
  }, [form, incomingParameters])

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
    try { window.localStorage.setItem('studio-novelai-draft-v1', JSON.stringify({ ...form.getFieldsValue(true), maskImageUrl: mask })) }
    catch { /* 浏览器禁用存储 */ }
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
        action: form.getFieldValue('action') === 'infill' ? 'infill' : 'img2img',
        width: targetSize.width,
        height: targetSize.height,
      })
      setMaskDataUrl(undefined)
      setViewSource(true)
      saveDraft(undefined)
      message.success(
        `已按参考图比例设为 ${targetSize.width}×${targetSize.height}`,
      )
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '参考图处理失败',
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
          image.url.split('/').pop()?.split(/[?#]/, 1)[0] || '图库图片'
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
      message.error('参考图不能超过 16 MiB')
      return false
    }
    await stageReferenceImage({ name: file.name, source: '上传文件' }, async () => {
      const image = await imageBlobToUploadDataUrl(file)
      return uploadInputImageBase64(image, {
        maxDimension: NOVELAI_REFERENCE_MAX_DIMENSION,
      })
    })
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
      if (blob.size > NOVELAI_REFERENCE_MAX_BYTES) throw new Error('参考图不能超过 16 MiB')
      const url = await imageBlobToUploadDataUrl(blob)
      if (imageId === optimizeImageId.current) setOptimizeImage({ name, url })
    } catch (error) {
      if (imageId === optimizeImageId.current)
        message.error(error instanceof Error ? error.message : '优化参考图读取失败')
    }
  }

  function selectOptimizeGalleryImage() {
    openGallery({ maxCount: 1, onSelect: (images) => {
      const image = images[0]
      if (!image) return
      void setOptimizeReference('图库参考图', async () => {
        const response = await fetch(image.url)
        if (!response.ok) throw new Error('图库参考图读取失败')
        return response.blob()
      })
    } })
  }

  async function optimizePrompt() {
    if (!optimizeText.trim() && !optimizeImage) {
      message.warning('请填写提示词或添加参考图')
      return
    }
    const endpointId = llmEndpoints.find((endpoint) => endpoint.id === optimizeEndpointId)?.id
      || llmEndpoints[0]?.id
    if (!endpointId) {
      openSettingModal({ initialTab: 'llm-endpoints' })
      return
    }
    if (!optimizeEndpointId) setOptimizeEndpointId(endpointId)
    const requestId = ++optimizeRequestId.current
    setOptimizeLoading(true)
    try {
      const content: ChatContentPart[] = []
      if (optimizeText.trim()) content.push({ type: 'text', text: optimizeText.trim() })
      if (optimizeImage) content.push({ type: 'image_url', image_url: { url: optimizeImage.url } })
      const inpaint = form.getFieldValue('action') === 'infill'
      const systemPrompt = inpaint
        ? promptMode === 'furry' ? llmPrompts.novelaiInpaintFurryPrompt : llmPrompts.novelaiInpaintAnimePrompt
        : promptMode === 'furry' ? llmPrompts.novelaiFurryPrompt : llmPrompts.novelaiAnimePrompt
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ]
      const result = await requestChatCompletion({ endpointId, messages })
      if (requestId === optimizeRequestId.current) {
        if (!result.trim()) throw new Error('优化结果为空')
        setOptimizeText(result)
      }
    } catch (error) {
      if (requestId === optimizeRequestId.current)
        message.error(error instanceof Error ? error.message : '提示词优化失败')
    } finally {
      if (requestId === optimizeRequestId.current) setOptimizeLoading(false)
    }
  }

  function adoptOptimizedPrompt() {
    const parsed = parseNovelAIOptimizedPrompt(optimizeText)
    if (!parsed.prompt && !parsed.uc && !parsed.characters.length) {
      message.warning('没有可采纳的提示词内容')
      return
    }
    const existing = form.getFieldValue('characters') || []
    form.setFieldsValue({
      ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
      ...(parsed.uc ? { negativePrompt: parsed.uc } : {}),
      ...(parsed.characters.length ? {
        characters: parsed.characters.map((prompt, index) => ({
          ...existing[index], prompt, negativePrompt: existing[index]?.negativePrompt || '',
        })),
      } : {}),
    })
    saveDraft()
    closeOptimize()
  }

  async function generate() {
    if (!settings.configured) {
      message.warning('请先保存 NovelAI API Token')
      return
    }
    await form.validateFields()
    const values = form.getFieldsValue(true) as NovelAIStudioGenerateRequest
    if (values.action === 'img2img' && !values.referenceImageUrl) {
      message.warning('图生图需要参考图')
      return
    }
    if (values.action === 'infill' && (!values.referenceImageUrl || !maskDataUrl)) {
      message.warning('局部重绘需要参考图和涂抹区域')
      return
    }
    if (values.action === 'infill' && values.model !== 'nai-diffusion-5-full' && !values.model.startsWith('nai-diffusion-4')) {
      message.warning('当前模型不支持局部重绘，请选择 V5 Full 或 V4/V4.5')
      return
    }
    if (values.preciseReference?.imageUrl && !values.model.startsWith('nai-diffusion-4-5-')) {
      message.warning('精密参考仅支持 V4.5 模型')
      return
    }
    setGenerating(true)
    try {
      const maskImageUrl = values.action === 'infill' && maskDataUrl?.startsWith('data:')
        ? (await uploadNovelAIMask(maskDataUrl)).url
        : values.action === 'infill' ? maskDataUrl : undefined
      const { preciseReference, ...plainValues } = values
      const characters = (values.characters || []).map((character, index) => {
        const { position, ...rest } = character
        if ((position?.x == null) !== (position?.y == null))
          throw new Error(`角色 ${index + 1} 的横向和纵向位置需同时填写`)
        return position?.x == null ? rest : { ...rest, position }
      })
      const result = await generateNovelAIStudioImages({
        ...plainValues,
        characters,
        prompt: promptMode === 'furry'
          ? (/^\s*fur dataset\s*,/i.test(values.prompt) ? values.prompt : `fur dataset, ${values.prompt.trim()}`)
          : values.prompt.replace(/^\s*fur dataset\s*,\s*/i, ''),
        referenceImageUrl: values.action === 'generate' ? undefined : values.referenceImageUrl,
        ...(preciseReference?.imageUrl ? { preciseReference } : {}),
        maskImageUrl,
        saveToTaskList:
          gptImageSettings.autoSaveStudioTasksToTaskList ?? false,
      })
      onItems([...result.items, ...(result.rawItems || [])])
      if (result.warning) message.warning(result.warning)
      setRecentResults(result.items)
      setViewSource(false)
      if (result.items[0]) {
        onSelectItem(result.items[0].id)
        onMobilePanel('canvas')
      }
      message.success(`NovelAI 已生成 ${result.items.length} 张图片${result.rawItems?.length ? `，另存 ${result.rawItems.length} 张上游原始结果` : ''}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'NovelAI 生成失败')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className={`studio-novelai-workbench is-mobile-${mobilePanel}`}>
      <aside className="studio-novelai-parameters">
        <header className="studio-novelai-parameters-header"><strong>生成参数</strong><span>GENERATION</span></header>
        <div className="studio-novelai-parameters-scroll">
    <div className="studio-provider-panel">
      <Collapse size="small" items={[{ key: 'key', label: `NovelAI 连接 · ${settings.configured ? '已设置' : '未设置'}`, children: <ProviderKeyCard
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
          const status = await testStudioProvider('novelai')
          return status.anlas === undefined ? undefined : `Anlas 余额 ${status.anlas}`
        }}
      /> }]} />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ...INITIAL_VALUES, model: settings.model }}
        className="studio-generation-form"
        onValuesChange={() => saveDraft()}
      >
        <Form.Item label="生成模式" name="action">
          <Segmented block options={[
            { label: '文生图', value: 'generate' },
            { label: '图生图', value: 'img2img' },
            { label: '局部重绘', value: 'infill' },
          ]} onChange={(value) => {
            if (value !== 'infill') { setMaskDataUrl(undefined); saveDraft(undefined) }
            onMobilePanel('canvas')
          }} />
        </Form.Item>
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
                if (!model.startsWith('nai-diffusion-4-5-')) form.setFieldValue(['preciseReference', 'imageUrl'], undefined)
                saveDraft()
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
        <div className="studio-section-heading">
          <div><strong>提示词模式</strong><small>生成时按模式调整 fur dataset 标签</small></div>
          <Segmented value={promptMode} options={[{ label: 'Anime', value: 'anime' }, { label: 'Furry', value: 'furry' }]}
            onChange={(value) => {
              setPromptMode(value as 'anime' | 'furry')
              try { window.localStorage.setItem('studio-novelai-prompt-mode', value) } catch { /* 存储不可用 */ }
            }} />
        </div>
        <Button icon={<BulbOutlined />} onClick={() => {
          optimizeImageId.current++
          setOptimizeText(form.getFieldValue('prompt') || '')
          const referenceUrl = form.getFieldValue('action') !== 'generate'
            ? form.getFieldValue('referenceImageUrl') as string | undefined
            : undefined
          setOptimizeImage(referenceUrl ? {
            name: referenceImage?.url === referenceUrl ? referenceImage.name : '生图参考图',
            url: referenceUrl,
            automatic: true,
          } : null)
          setOptimizeOpen(true)
        }}>提示词优化</Button>
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
        {action !== 'generate' && <div
          className="studio-reference-section"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('application/x-linai-studio')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(event) => {
            const itemId = event.dataTransfer.getData('application/x-linai-studio')
            if (!itemId) return
            event.preventDefault()
            selectStudioReference(itemId)
          }}
        >
          <div className="studio-section-heading">
            <div>
              <strong>图生图参考图</strong>
              <small>拖入暂存台图片，或选择一张；自动匹配生成尺寸</small>
            </div>
          </div>
          <div className="studio-reference-actions">
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              placeholder="从暂存台选择"
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
              图库
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
                上传文件
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
                <span>来源：{referenceImage.source}</span>
                <span>
                  参考图 {referenceImage.sourceWidth}×
                  {referenceImage.sourceHeight} · 自动生成尺寸{' '}
                  {referenceImage.targetWidth}×{referenceImage.targetHeight}
                </span>
              </div>
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label="移除参考图"
                onClick={clearReferenceImage}
              />
            </div>
          ) : (
            <div className="studio-reference-empty">
              <PictureOutlined />
              <span>从暂存台拖入图片，或在上方选择参考图</span>
            </div>
          )}
          <div className="studio-slider-grid">
            <Form.Item label="图像变化强度" name="strength">
              <Slider min={0} max={1} step={0.01} disabled={!referenceImage} />
            </Form.Item>
            <Form.Item label="额外噪声" name="noise">
              <Slider min={0} max={1} step={0.01} disabled={!referenceImage} />
            </Form.Item>
          </div>
          {action === 'infill' && <Alert
            type="info"
            showIcon
            title="在中间画布涂抹需要重绘的区域"
            description="小范围重绘建议开启聚焦，并让遮罩略宽于目标轮廓；提示词只描述要改的局部。"
          />}
          {action === 'infill' && <>
            <Form.Item label="聚焦局部重绘" name="focusedInpaint" valuePropName="checked"
              extra="放大遮罩附近的画面生成，再按所选方式融合；范围过大时使用整图。">
              <Switch />
            </Form.Item>
            {focusedInpaint && <Form.Item label="蒙版外上下文像素" name="inpaintContextPixels"
              extra="保留在遮罩周围供模型参考的原图范围；过小可能失去结构信息。">
              <Slider min={32} max={512} step={32} />
            </Form.Item>}
            {focusedInpaint && <Form.Item label="边缘融合方式" name="inpaintBlendMode"
              extra={inpaintBlendMode === 'soft'
                ? '在蒙版边界两侧柔和融合，允许改变外侧过渡范围内的像素；小选区不会自动缩短半径，中心也可能混入原图。'
                : '只在蒙版内侧过渡，蒙版外像素保持不变；小选区会自动缩短宽度，20 和 32 的实际效果可能接近。'}>
              <Select options={[
                { label: '柔和融合', value: 'soft' },
                { label: '严格保留蒙版外', value: 'strict' },
              ]} />
            </Form.Item>}
            {focusedInpaint && <Form.Item label={inpaintBlendMode === 'soft' ? '过渡半径（原图像素）' : '最大内侧过渡像素'} name="inpaintFeatherPixels"
              extra="用于衔接边缘，不能保证修正生成内容内部的结构、纹理或光照差异。">
              <Slider min={4} max={32} step={4} />
            </Form.Item>}
            <Form.Item label="另存上游原始结果" name="saveInpaintRaw" valuePropName="checked"
              extra="额外保存到暂存台，供对照合成前后的变化；聚焦时保存的是放大的局部图。">
              <Switch />
            </Form.Item>
          </>}
        </div>}
        <Collapse ghost items={[{ key: 'precise', label: '精密参考（V4.5）', children: <>
          <Alert type="info" showIcon title="可参考人物、画风，或两者一起；与图生图参考图用途不同" />
          <Form.Item label="暂存台素材" name={['preciseReference', 'imageUrl']}>
            <Select allowClear showSearch optionFilterProp="label" placeholder="选择精密参考图"
              disabled={!model.startsWith('nai-diffusion-4-5-')}
              options={[
                ...(preciseImageUrl && preciseImageUrl.startsWith('/api/') ? [{ label: '当前精密参考图', value: preciseImageUrl }] : []),
                ...items.filter((item) => item.format !== 'psd').map((item) => ({label:item.name,value:studioFileUrl(item.id)})),
              ]}
              onChange={(url) => {
                if (url) {
                  setPreciseLoading(true)
                  void uploadInputImageFromUrl(url, {maxDimension:2048}).then((inputUrl) => { form.setFieldValue(['preciseReference','imageUrl'], inputUrl); saveDraft() }).catch((error) => message.error(error instanceof Error ? error.message : '精密参考上传失败')).finally(() => setPreciseLoading(false))
                }
              }}
            />
          </Form.Item>
          <Upload accept={REFERENCE_ACCEPT} showUploadList={false} beforeUpload={async (file) => {
            setPreciseLoading(true)
            try { form.setFieldValue(['preciseReference','imageUrl'], await uploadInputImageBase64(await imageBlobToUploadDataUrl(file), {maxDimension:2048})); saveDraft() }
            catch (error) { message.error(error instanceof Error ? error.message : '精密参考上传失败') }
            finally { setPreciseLoading(false) }
            return false
          }}><Button loading={preciseLoading} disabled={!model.startsWith('nai-diffusion-4-5-')} icon={<UploadOutlined />}>上传参考图</Button></Upload>
          <Form.Item label="参考类型" name={['preciseReference','type']} initialValue="character"><Select options={[
            {label:'角色外观',value:'character'},{label:'画风',value:'style'},{label:'角色与画风',value:'character-and-style'},
          ]} /></Form.Item>
          <Form.Item label="参考强度" name={['preciseReference','strength']} initialValue={0.7}><Slider min={0} max={1} step={0.01} /></Form.Item>
          <Form.Item label="忠实度" name={['preciseReference','fidelity']} initialValue={0.7}><Slider min={0} max={1} step={0.01} /></Form.Item>
        </> }]} />
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
                    <Space size={4}>
                      <NovelAICharacterImagePrompt mode={promptMode} onAdopt={(prompt, uc) => {
                        const characters = form.getFieldValue('characters') || []
                        form.setFieldValue(['characters', field.name], {
                          ...characters[field.name], prompt, negativePrompt: uc,
                        })
                        saveDraft()
                      }} />
                      <Button
                        danger
                        type="text"
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    </Space>
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
                  <div className="studio-form-grid studio-form-grid-wide">
                    <Form.Item label="横向位置（0–1）" name={[field.name, 'position', 'x']}><InputNumber min={0} max={1} step={0.05} /></Form.Item>
                    <Form.Item label="纵向位置（0–1）" name={[field.name, 'position', 'y']}><InputNumber min={0} max={1} step={0.05} /></Form.Item>
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
                    {!model.startsWith('nai-diffusion-5-') && <Form.Item
                      label="自动质量标签"
                      name="qualityToggle"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>}
                  </Space>
                  {model.startsWith('nai-diffusion-5-') && <Form.Item label="画质标签" name="qualityPreset"><Select options={[
                    {label:'关闭',value:'none'},{label:'Light',value:'light'},{label:'Standard',value:'standard'},
                  ]} /></Form.Item>}
                  <Form.Item label="UC 预设" name="ucPreset"><Select options={[
                    {label:'Heavy',value:0},{label:'Light',value:1},{label:'Furry Focus',value:2,disabled:model==='nai-diffusion-4-5-curated'},{label:'Human Focus',value:3},{label:'关闭',value:4},
                  ]} /></Form.Item>
                </>
              ),
            },
          ]}
        />
      </Form>
      <Modal title={`NovelAI ${promptMode === 'furry' ? 'Furry' : 'Anime'} ${action === 'infill' ? '局部重绘' : '文生图/图生图'}提示词优化`}
        open={optimizeOpen} onCancel={closeOptimize} onOk={adoptOptimizedPrompt}
        okText="采纳" cancelText="丢弃" okButtonProps={{ disabled: optimizeLoading || !optimizeText.trim() }}
        width={680} destroyOnHidden>
        <Input.TextArea value={optimizeText} onChange={(event) => setOptimizeText(event.target.value)}
          autoSize={{ minRows: 8, maxRows: 18 }} placeholder="填写提示词或描述；优化结果会显示在这里" />
        <Space wrap style={{ marginTop: 12 }}>
          <Upload accept={REFERENCE_ACCEPT} showUploadList={false} beforeUpload={(file) => {
            void setOptimizeReference(file.name, async () => file)
            return false
          }}><Button icon={<UploadOutlined />}>上传图片</Button></Upload>
          <Button icon={<PictureOutlined />} onClick={selectOptimizeGalleryImage}>图库</Button>
          {optimizeImage && <>
            <img src={optimizeImage.url} alt={optimizeImage.name} style={{ width: 48, height: 48, objectFit: 'cover' }} />
            <span>{optimizeImage.automatic ? '自动带入：' : ''}{optimizeImage.name}</span>
            <Button size="small" onClick={() => { optimizeImageId.current++; setOptimizeImage(null) }}>移除</Button>
          </>}
        </Space>
        <div style={{ marginTop: 12 }}>
          <Button type="primary" loading={optimizeLoading} onClick={() => void optimizePrompt()}>优化</Button>
        </div>
        <div style={{ marginTop: 8, color: '#94a3b8' }}>
          {action === 'infill'
            ? '默认带入未标遮罩的参考原图；如手动换图，则发送换后的图。请在文字中说明要重绘的局部和目标内容。'
            : '参考图仅发送给提示词优化端点；采纳时分别填入提示词、UC 和角色提示词。'}
        </div>
      </Modal>
    </div>
        </div>
        <div className="studio-novelai-generate">
          <Button type="primary" size="large" icon={<ThunderboltOutlined />}
            loading={generating} disabled={!settings.configured}
            onClick={() => void generate()}>生成到暂存台</Button>
        </div>
      </aside>
      <div className="studio-novelai-stage">
        <NovelAICanvas
          imageUrl={canvasImage}
          name={action === 'infill' ? referenceImage?.name : selectedItem?.name || referenceImage?.name}
          width={action === 'infill' ? targetWidth : undefined}
          height={action === 'infill' ? targetHeight : undefined}
          mode={action === 'infill' ? 'mask' : 'view'}
          maskDataUrl={maskDataUrl}
          onMaskChange={(value) => { setMaskDataUrl(value); saveDraft(value) }}
          generating={generating}
          actions={<>
            {referenceImage && action !== 'infill' && <Button size="small" onClick={() => setViewSource((value) => !value)}>{viewSource ? '查看结果' : '查看参考图'}</Button>}
            {selectedItem && selectedItem.format !== 'psd' && <Button size="small" onClick={() => {
              void stageReferenceImage({name:selectedItem.name,source:'暂存台',sourceId:selectedItem.id}, () => uploadInputImageFromUrl(studioFileUrl(selectedItem.id), {maxDimension:2048}))
              onMobilePanel('parameters')
            }}>用作图生图</Button>}
            {selectedItem && <Button size="small" onClick={() => onOpenPhotopea(selectedItem)}>在 Photopea 打开</Button>}
          </>}
          emptyActions={<Button onClick={() => onMobilePanel('parameters')}>设置生成参数</Button>}
        />
        {recentResults.length > 1 && <div className="novelai-result-strip" aria-label="本次生成结果">
          {recentResults.map((item) => <button key={item.id} className={selectedItemId === item.id ? 'is-selected' : ''} onClick={() => onSelectItem(item.id)} aria-label={`查看 ${item.name}`}><img src={studioFileUrl(item.id)} alt={item.name} /></button>)}
        </div>}
      </div>
    </div>
  )
}
