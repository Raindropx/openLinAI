import { PictureOutlined } from '@ant-design/icons'
import { Button, Input, Modal, Upload, message } from 'antd'
import { useState } from 'react'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { requestChatCompletion, type ChatMessage } from '../../../hooks/useChatCompletion'
import { useGlobalStore } from '../../../store/global'
import { imageBlobToUploadDataUrl } from '../../../utils/image'
import { openSettingModal } from '../SettingModal'

const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/svg+xml,.svg'

function parseCharacterResult(raw: string) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回角色提示词和 UC，请重试')

  let value: unknown
  try {
    value = JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new Error('模型返回格式不正确，请重试')
  }
  if (!value || typeof value !== 'object') throw new Error('模型返回格式不正确，请重试')
  const result = value as Record<string, unknown>
  if (typeof result.prompt !== 'string' || !result.prompt.trim()
    || typeof result.uc !== 'string' || !result.uc.trim()) {
    throw new Error('模型没有返回完整的角色提示词和 UC，请重试')
  }
  return { prompt: result.prompt.trim(), uc: result.uc.trim() }
}

export function NovelAICharacterImagePrompt({
  mode,
  onAdopt,
}: {
  mode: 'anime' | 'furry'
  onAdopt: (prompt: string, uc: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [image, setImage] = useState<{ name: string; url: string } | null>(null)
  const [prompt, setPrompt] = useState('')
  const [uc, setUc] = useState('')
  const { optimizeEndpointId, setOptimizeEndpointId } = useLocalSetting()
  const { llmEndpoints, llmPrompts } = useGlobalStore()

  async function generateFromImage(file: File) {
    if (loading) return
    if (file.size > MAX_IMAGE_BYTES) {
      message.error('角色图片不能超过 16 MiB')
      return
    }
    if (!file.type.startsWith('image/') && !/\.svg$/i.test(file.name)) {
      message.error('请选择图片文件')
      return
    }
    const endpointId = llmEndpoints.find((endpoint) => endpoint.id === optimizeEndpointId)?.id
      || llmEndpoints[0]?.id
    if (!endpointId) {
      openSettingModal({ initialTab: 'llm-endpoints' })
      return
    }
    if (!optimizeEndpointId) setOptimizeEndpointId(endpointId)

    setLoading(true)
    try {
      const url = await imageBlobToUploadDataUrl(file)
      const systemPrompt = mode === 'furry'
        ? llmPrompts.novelaiFurryPrompt : llmPrompts.novelaiAnimePrompt
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `${systemPrompt}\n\n当前任务只生成一个角色的 NovelAI V5 Character Prompt 和该角色专用 UC。遵循上述 Anime/Furry 标签规则，但不要输出 Base Prompt、场景、构图、画质标签或全局 UC。只根据图片中可见的角色特征编写，不确定的细节不要臆造。只返回 JSON 对象，字段严格为 "prompt" 和 "uc"，值均为可直接使用的英文标签字符串，不要 Markdown 或解释。`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请从这张图片提取角色外观、服装、表情等角色专属特征，生成该角色的 Character Prompt 和角色 UC。' },
            { type: 'image_url', image_url: { url } },
          ],
        },
      ]
      const result = parseCharacterResult(await requestChatCompletion({ endpointId, messages }))
      setImage({ name: file.name, url })
      setPrompt(result.prompt)
      setUc(result.uc)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '角色提示词生成失败')
    } finally {
      setLoading(false)
    }
  }

  function close() {
    setImage(null)
    setPrompt('')
    setUc('')
  }

  return <>
    <Upload accept={IMAGE_ACCEPT} showUploadList={false} beforeUpload={(file) => {
      void generateFromImage(file)
      return false
    }}>
      <Button size="small" icon={<PictureOutlined />} loading={loading}>图片生成</Button>
    </Upload>
    <Modal title="从角色图片生成提示词" open={Boolean(image)} onCancel={close}
      onOk={() => {
        if (!prompt.trim() || !uc.trim()) {
          message.warning('请填写角色提示词和 UC')
          return
        }
        onAdopt(prompt.trim(), uc.trim())
        close()
      }} okText="填入角色" cancelText="取消" width={600} destroyOnHidden>
      {image && <div style={{ marginBottom: 12 }}>
        <img src={image.url} alt={image.name} style={{ width: 64, height: 64, objectFit: 'cover' }} />
        <span style={{ marginLeft: 8 }}>{image.name}</span>
      </div>}
      <div style={{ marginBottom: 8 }}>角色提示词</div>
      <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)}
        autoSize={{ minRows: 3, maxRows: 8 }} />
      <div style={{ margin: '12px 0 8px' }}>角色 UC</div>
      <Input.TextArea value={uc} onChange={(event) => setUc(event.target.value)}
        autoSize={{ minRows: 2, maxRows: 6 }} />
    </Modal>
  </>
}
