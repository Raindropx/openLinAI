import {
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
  Select,
  Slider,
  Space,
  Switch,
  Upload,
  message,
} from 'antd'
import { useEffect, useState } from 'react'
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
import { imageBlobToUploadDataUrl } from '../../../utils/image'
import {
  uploadInputImageBase64,
  uploadInputImageFromUrl,
} from '../../../utils/uploadInputImage'
import { openGallery } from '../components/Gallery'
import {
  generateNovelAIStudioImages,
  testStudioProvider,
  updateNovelAISettings,
} from './api'
import { ProviderKeyCard } from './ProviderKeyCard'

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
}: {
  settings: StudioProviderSettings['novelai']
  items: StudioItem[]
  onSettings: (settings: StudioProviderSettings) => void
  onItems: (items: StudioItem[]) => void
}) {
  const [form] = Form.useForm<NovelAIStudioGenerateRequest>()
  const [generating, setGenerating] = useState(false)
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [referenceImage, setReferenceImage] =
    useState<SelectedReferenceImage | null>(null)
  const { gptImageSettings } = useLocalSetting()

  useEffect(() => {
    form.setFieldValue('model', settings.model)
  }, [form, settings.model])

  function clearReferenceImage() {
    setReferenceImage(null)
    form.setFieldValue('referenceImageUrl', undefined)
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
        width: targetSize.width,
        height: targetSize.height,
      })
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

  async function generate() {
    if (!settings.configured) {
      message.warning('请先保存 NovelAI API Token')
      return
    }
    const values = await form.validateFields()
    setGenerating(true)
    try {
      const result = await generateNovelAIStudioImages({
        ...values,
        saveToTaskList:
          gptImageSettings.autoSaveStudioTasksToTaskList ?? false,
      })
      onItems(result.items)
      message.success(`NovelAI 已生成 ${result.items.length} 张图片`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'NovelAI 生成失败')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="studio-provider-panel">
      <ProviderKeyCard
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
          await testStudioProvider('novelai')
          return undefined
        }}
      />
      <Alert
        showIcon
        type="info"
        title="已接入原生文生图、图生图、UC 与角色提示词"
        description="图生图支持暂存台、图库和本地文件。SVG 及其他非直接格式会先渲染为单帧位图，再按目标尺寸送入 NovelAI。"
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ...INITIAL_VALUES, model: settings.model }}
        className="studio-generation-form"
      >
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
        <div className="studio-reference-section">
          <div className="studio-section-heading">
            <div>
              <strong>图生图参考图</strong>
              <small>
                仅使用一张；自动读取比例并匹配最接近的 64 倍数生成尺寸
              </small>
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
              <span>未选择参考图，将使用文生图模式</span>
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
        </div>
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
                    <Button
                      danger
                      type="text"
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(field.name)}
                    />
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
                    <Form.Item
                      label="自动质量标签"
                      name="qualityToggle"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>
                  </Space>
                </>
              ),
            },
          ]}
        />
        <Button
          type="primary"
          size="large"
          icon={<ThunderboltOutlined />}
          loading={generating}
          disabled={!settings.configured}
          onClick={() => void generate()}
        >
          生成到暂存台
        </Button>
      </Form>
    </div>
  )
}
