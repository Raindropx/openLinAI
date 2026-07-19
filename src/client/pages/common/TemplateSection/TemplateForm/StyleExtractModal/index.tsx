import {
  CloseOutlined,
  CopyOutlined,
  InboxOutlined,
  PictureOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import {
  Button,
  Checkbox,
  Image as AntImage,
  Input,
  Modal,
  Select,
  Spin,
  Upload,
  message,
} from 'antd'
import type { UploadProps } from 'antd'
import { hc } from 'hono/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppType } from '../../../../../../server'
import { requestChatCompletion } from '../../../../../hooks/useChatCompletion'
import { useLocalSetting } from '../../../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../../../store/global'
import { imageBlobToUploadDataUrl } from '../../../../../utils/image'
import {
  openGallery,
  type GalleryImageSelection,
} from '../../../components/Gallery'
import {
  optimizeStyleTemplate,
  resolveStylePrompt,
} from '../styleOptimize'

const client = hc<AppType>('/')

interface StyleAnalysis {
  media_style: string
  camera_lens: string
  composition: string
  color_palette: string
  lighting: string
  texture_effects: string
  subject_main: string
  subject_detail: string
  environment: string
  ui_text: string
  atmosphere: string
  art_reference: string
}

const DIMENSIONS: Array<{
  key: keyof StyleAnalysis
  label: string
  hint: string
}> = [
  { key: 'media_style', label: '媒介与风格', hint: '媒介、艺术风格、载体形式' },
  { key: 'camera_lens', label: '镜头与视角', hint: '视角、镜头类型、取景方式' },
  { key: 'composition', label: '构图', hint: '布局、主体位置、画幅关系' },
  { key: 'color_palette', label: '色彩与色调', hint: '主色、饱和度、冷暖倾向' },
  { key: 'lighting', label: '光影', hint: '光源方向、光质、阴影' },
  { key: 'texture_effects', label: '质感与特效', hint: '颗粒、材质、后期效果' },
  { key: 'subject_main', label: '主体描述', hint: '核心主体、形态、动作、表情' },
  { key: 'subject_detail', label: '主体细节', hint: '穿戴、材质、妆容等细节' },
  { key: 'environment', label: '环境与背景', hint: '场景、地点、物件、天气' },
  { key: 'ui_text', label: '文字与 UI', hint: '文字、字幕、界面元素' },
  { key: 'atmosphere', label: '氛围与情绪', hint: '心理感受、情绪关键词' },
  { key: 'art_reference', label: '艺术参考', hint: '艺术家、作品、文化符号' },
]

const EMPTY_ANALYSIS = Object.fromEntries(
  DIMENSIONS.map(({ key }) => [key, '']),
) as unknown as StyleAnalysis

const SYSTEM_PROMPT = `你是专业的图片风格分析助手。请观察图片，从以下 12 个维度提炼适合直接用于生图提示词的中文关键词：media_style、camera_lens、composition、color_palette、lighting、texture_effects、subject_main、subject_detail、environment、ui_text、atmosphere、art_reference。

只返回一个 JSON 对象，不要说明文字或 Markdown。所有字段都必须存在且值必须是字符串；无法观察的维度返回空字符串。描述应精炼、具体，用中文顿号连接关键词。`

function parseAnalysis(content: string): StyleAnalysis {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || content.match(/\{[\s\S]*\}/)?.[0] || content
  let value: unknown
  try {
    value = JSON.parse(candidate.trim())
  } catch {
    throw new Error('无法解析模型返回的风格数据，请重试或更换端点')
  }
  if (!value || typeof value !== 'object') {
    throw new Error('模型返回的风格数据格式不正确')
  }
  const record = value as Record<string, unknown>
  if (!DIMENSIONS.every(({ key }) => typeof record[key] === 'string')) {
    throw new Error('模型返回的风格数据缺少必要字段')
  }
  return record as unknown as StyleAnalysis
}

async function uploadDataUrl(image: string) {
  const res = await client.api.static.images.upload.$post({ json: { image } })
  const data = await res.json()
  if (!data.success || !('url' in data)) {
    throw new Error('error' in data ? String(data.error) : '图片上传失败')
  }
  return data.url
}

async function normalizeGalleryImage(image: GalleryImageSelection) {
  if (image.type === 'input') return image.url
  const response = await fetch(image.url)
  if (!response.ok) throw new Error('图库图片读取失败')
  return uploadDataUrl(await imageBlobToUploadDataUrl(await response.blob()))
}

function composePrompt(
  analysis: StyleAnalysis,
  selected: Set<keyof StyleAnalysis>,
) {
  return DIMENSIONS.flatMap(({ key }) => {
    const value = analysis[key].trim()
    return selected.has(key) && value ? [value] : []
  }).join('，')
}

export function StyleExtractModal({
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
  const llmEndpoints = useGlobalStore((state) => state.llmEndpoints)
  const styleOptimizePrompt = useGlobalStore(
    (state) => state.llmPrompts.styleOptimizePrompt,
  )
  const {
    styleExtractEndpointId,
    setStyleExtractEndpointId,
    optimizeEndpointId,
    setOptimizeEndpointId,
  } = useLocalSetting()
  const endpointId =
    llmEndpoints.some((endpoint) => endpoint.id === styleExtractEndpointId)
      ? styleExtractEndpointId
      : llmEndpoints[0]?.id
  const [imageUrl, setImageUrl] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [analysis, setAnalysis] = useState<StyleAnalysis>(EMPTY_ANALYSIS)
  const [selected, setSelected] = useState<Set<keyof StyleAnalysis>>(
    () => new Set(DIMENSIONS.map(({ key }) => key)),
  )
  const [result, setResult] = useState('')
  const [manualResult, setManualResult] = useState(false)
  const [presetNameOpen, setPresetNameOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetSaving, setPresetSaving] = useState(false)
  const [styleOptimizing, setStyleOptimizing] = useState(false)
  const imageOperationIdRef = useRef(0)

  const composed = useMemo(
    () => composePrompt(analysis, selected),
    [analysis, selected],
  )

  useEffect(() => {
    if (!manualResult) setResult(composed)
  }, [composed, manualResult])

  const reset = () => {
    imageOperationIdRef.current += 1
    setImageUrl('')
    setPreviewUrl('')
    setAnalysis(EMPTY_ANALYSIS)
    setSelected(new Set(DIMENSIONS.map(({ key }) => key)))
    setResult('')
    setManualResult(false)
  }

  const close = () => {
    if (busy) return
    setPresetNameOpen(false)
    setPresetName('')
    reset()
    onClose()
  }

  const selectImage = async (selection: GalleryImageSelection) => {
    const operationId = ++imageOperationIdRef.current
    setBusy(true)
    setImageUrl('')
    setAnalysis(EMPTY_ANALYSIS)
    setSelected(new Set(DIMENSIONS.map(({ key }) => key)))
    setResult('')
    setManualResult(false)
    try {
      setPreviewUrl(selection.url)
      const normalizedUrl = await normalizeGalleryImage(selection)
      if (imageOperationIdRef.current !== operationId) return
      setImageUrl(normalizedUrl)
    } catch (error) {
      if (imageOperationIdRef.current !== operationId) return
      message.error(error instanceof Error ? error.message : '图片处理失败')
      setImageUrl('')
      setPreviewUrl('')
    } finally {
      if (imageOperationIdRef.current === operationId) setBusy(false)
    }
  }

  const handleUpload: UploadProps['beforeUpload'] = async (file) => {
    const operationId = ++imageOperationIdRef.current
    setBusy(true)
    setImageUrl('')
    setPreviewUrl('')
    setAnalysis(EMPTY_ANALYSIS)
    setSelected(new Set(DIMENSIONS.map(({ key }) => key)))
    setResult('')
    setManualResult(false)
    try {
      // 仅 WebP 在浏览器中转成 JPEG，避免依赖 OpenWrt FFmpeg 的 WebP 解码器。
      const dataUrl = await imageBlobToUploadDataUrl(file)
      if (imageOperationIdRef.current !== operationId) return false
      setPreviewUrl(dataUrl)
      const uploadedUrl = await uploadDataUrl(dataUrl)
      if (imageOperationIdRef.current !== operationId) return false
      setImageUrl(uploadedUrl)
    } catch (error) {
      if (imageOperationIdRef.current !== operationId) return false
      message.error(error instanceof Error ? error.message : '图片上传失败')
      setImageUrl('')
      setPreviewUrl('')
    } finally {
      if (imageOperationIdRef.current === operationId) setBusy(false)
    }
    return false
  }

  const analyze = async () => {
    if (!imageUrl) return message.warning('请先选择图片')
    if (!endpointId) return message.warning('请先在设置中配置 LLM 端点')
    setBusy(true)
    try {
      setStyleExtractEndpointId(endpointId)
      const content = await requestChatCompletion({
        endpointId,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl } },
              { type: 'text', text: SYSTEM_PROMPT },
            ],
          },
        ],
      })
      setAnalysis(parseAnalysis(content))
      setSelected(new Set(DIMENSIONS.map(({ key }) => key)))
      setManualResult(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '风格分析失败')
    } finally {
      setBusy(false)
    }
  }

  const saveAsPreset = async () => {
    const name = presetName.trim()
    const prompt = result.trim()
    if (!name) return message.warning('请输入风格预设名称')
    if (!prompt) return message.warning('没有可保存的组合提示词')
    setPresetSaving(true)
    try {
      const template = prompt.includes('{prompt}')
        ? prompt
        : `{prompt}。${prompt}`
      const response = await client.api['style-preset'].$post({
        json: { name, prompt: template, origin: 'style-extract' },
      })
      const data = await response.json()
      if (!data.success) throw new Error('风格预设保存失败')
      setPresetNameOpen(false)
      setPresetName('')
      message.success('已加入风格预设')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '风格预设保存失败')
    } finally {
      setPresetSaving(false)
    }
  }

  const optimizeResult = async () => {
    const source = result.trim()
    if (!source) return message.warning('没有可优化的组合提示词')
    const optimizeId = optimizeEndpointId || llmEndpoints[0]?.id
    if (!optimizeId) return message.warning('请先在设置中配置 LLM 端点')
    if (!styleOptimizePrompt.trim()) {
      return message.warning('请先在设置中配置风格优化系统提示词')
    }
    if (!optimizeEndpointId) setOptimizeEndpointId(optimizeId)
    setStyleOptimizing(true)
    try {
      const optimized = await optimizeStyleTemplate({
        endpointId: optimizeId,
        systemPrompt: styleOptimizePrompt,
        source,
      })
      setManualResult(true)
      setResult(optimized)
      message.success('风格模板优化完成')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '风格模板优化失败')
    } finally {
      setStyleOptimizing(false)
    }
  }

  return (
    <>
    <Modal
      title="图片风格提取"
      open={open}
      onCancel={close}
      width={780}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={close} disabled={busy}>取消</Button>,
        <Button
          key="copy"
          icon={<CopyOutlined />}
          disabled={!result}
          onClick={() => navigator.clipboard.writeText(result).then(() => message.success('已复制'))}
        >
          复制
        </Button>,
        <Button
          key="apply"
          type="primary"
          disabled={!result}
          onClick={() => onApply(resolveStylePrompt(result, currentPrompt))}
        >
          应用到提示词
        </Button>,
      ]}
    >
      <Spin spinning={busy}>
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-[240px_1fr]">
            <Upload.Dragger
              accept="image/jpeg,image/png,image/webp"
              showUploadList={false}
              beforeUpload={handleUpload}
              disabled={busy}
              openFileDialogOnClick={!previewUrl}
              className="[&_.ant-upload]:!p-2"
            >
              <div className="relative flex h-40 w-full items-center justify-center overflow-hidden">
                {previewUrl ? (
                  <>
                    <AntImage
                      src={previewUrl}
                      alt="待分析图片"
                      styles={{
                        root: {
                          display: 'block',
                          width: '100%',
                          height: '100%',
                        },
                        image: {
                          display: 'block',
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                        },
                      }}
                      preview={{ mask: '预览图片' }}
                    />
                    <Button
                      type="text"
                      shape="circle"
                      icon={<CloseOutlined />}
                      aria-label="清除图片"
                      disabled={busy}
                      className="bg-white/90! text-gray-600! shadow-sm"
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        zIndex: 10,
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        reset()
                      }}
                    />
                  </>
                ) : (
                  <div className="text-center text-gray-400">
                    <InboxOutlined className="mb-2 text-3xl" />
                    <div>拖入或选择本地图片</div>
                  </div>
                )}
              </div>
            </Upload.Dragger>
            <div className="space-y-3">
              <Button
                block
                icon={<PictureOutlined />}
                disabled={busy}
                onClick={() => openGallery({
                  onSelect: (images) => {
                    if (images[0]) void selectImage(images[0])
                  },
                })}
              >
                从图库选择
              </Button>
              <div>
                <div className="mb-1 text-sm text-gray-600">LLM 端点</div>
                <Select
                  className="w-full"
                  value={endpointId}
                  placeholder="请选择支持视觉识别的端点"
                  notFoundContent="请先在设置中配置 LLM 端点"
                  options={llmEndpoints.map((endpoint) => ({
                    value: endpoint.id,
                    label: endpoint.name || '未命名端点',
                  }))}
                  onChange={setStyleExtractEndpointId}
                />
                <div className="mt-1 text-xs text-gray-400">所选模型需支持图片输入</div>
              </div>
              <Button type="primary" block onClick={analyze} disabled={!imageUrl || !endpointId}>
                分析图片风格
              </Button>
            </div>
          </div>

          {composed && (
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3">
              {DIMENSIONS.map(({ key, label, hint }) => (
                <div key={key} className="grid items-start gap-2 md:grid-cols-[110px_1fr]">
                  <Checkbox
                    checked={selected.has(key)}
                    onChange={(event) => setSelected((previous) => {
                      const next = new Set(previous)
                      event.target.checked ? next.add(key) : next.delete(key)
                      return next
                    })}
                  >
                    {label}
                  </Checkbox>
                  <Input
                    value={analysis[key]}
                    placeholder={hint}
                    onChange={(event) => setAnalysis((previous) => ({
                      ...previous,
                      [key]: event.target.value,
                    }))}
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between text-sm text-gray-600">
              <span>组合提示词</span>
              <span className="flex flex-wrap justify-end gap-1">
                <Button
                  type="link"
                  size="small"
                  icon={<RobotOutlined />}
                  loading={styleOptimizing}
                  disabled={!result.trim()}
                  onClick={() => void optimizeResult()}
                >
                  AI 优化
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<SaveOutlined />}
                  disabled={!result.trim()}
                  onClick={() => setPresetNameOpen(true)}
                >
                  加入风格预设
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<ReloadOutlined />}
                  disabled={!composed}
                  onClick={() => {
                    setManualResult(false)
                    setResult(composed)
                  }}
                >
                  重新组合
                </Button>
              </span>
            </div>
            <Input.TextArea
              value={result}
              rows={4}
              placeholder="分析完成后，可在此编辑最终提示词"
              onChange={(event) => {
                setManualResult(true)
                setResult(event.target.value)
              }}
            />
          </div>
        </div>
      </Spin>
    </Modal>
      <Modal
        title="加入风格预设"
        open={presetNameOpen}
        width="min(480px, calc(100vw - 24px))"
        centered
        okText="保存"
        cancelText="取消"
        confirmLoading={presetSaving}
        onOk={() => void saveAsPreset()}
        onCancel={() => {
          if (presetSaving) return
          setPresetNameOpen(false)
          setPresetName('')
        }}
        destroyOnHidden
      >
        <div className="space-y-2">
          <div className="text-sm text-gray-600">预设名称</div>
          <Input
            autoFocus
            value={presetName}
            maxLength={80}
            showCount
            placeholder="例如：柔和复古胶片"
            onChange={(event) => setPresetName(event.target.value)}
            onPressEnter={() => void saveAsPreset()}
          />
          <div className="text-xs text-gray-400">
            保存时会自动加入 {'{prompt}'} 占位符，之后可在风格预设中继续编辑。
          </div>
        </div>
      </Modal>
    </>
  )
}
