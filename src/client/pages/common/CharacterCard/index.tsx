import {
  DownloadOutlined,
  FileImageOutlined,
  FileTextOutlined,
  PlusOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { Button, Input, message, Select, Tooltip, Upload } from 'antd'
import { useState } from 'react'
import {
  requestChatCompletion,
  type ChatMessage,
} from '../../../hooks/useChatCompletion'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../store/global'
import {
  emptyCharacterCard,
  exportCardAsJson,
  exportCardAsPng,
  extractExtraFields,
  extractJsonFromText,
  normalizeCharacterCard,
  parsePngCharacterCardRaw,
  toV2Format,
  type CharacterCard,
} from '../../../utils/characterCard'
import { openSettingModal } from '../SettingModal'
import { ImageUpload } from '../TemplateSection/TemplateForm/ImageUpload'

export function CharacterCardPage() {
  const { llmEndpoints, llmPrompts } = useGlobalStore()
  const { charCardEndpointId, setCharCardEndpointId } = useLocalSetting()

  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [card, setCard] = useState<CharacterCard>(emptyCharacterCard)
  const [hasCard, setHasCard] = useState(false)
  const [rawData, setRawData] = useState('')
  const [extraFields, setExtraFields] = useState<Record<string, any>>({})

  const endpointId = charCardEndpointId || llmEndpoints[0]?.id

  const updateField = <K extends keyof CharacterCard>(
    key: K,
    value: CharacterCard[K],
  ) => {
    setCard((prev) => ({ ...prev, [key]: value }))
  }

  const ensureEndpoint = (): string | null => {
    if (!endpointId) {
      message.warning('请先在设置中配置 LLM 端点')
      openSettingModal({ initialTab: 'llm-endpoints' })
      return null
    }
    if (!charCardEndpointId) setCharCardEndpointId(endpointId)
    return endpointId
  }

  /** 将原始 JSON 应用到编辑区域和额外字段 */
  const applyRawJson = (raw: any) => {
    const normalized = normalizeCharacterCard(raw)
    const extra = extractExtraFields(raw)
    setCard(normalized)
    setExtraFields(extra)
    setHasCard(true)
    // 同步原始数据文本框为格式化 JSON
    setRawData(JSON.stringify(toV2Format(normalized, extra), null, 2))
  }

  const handleGenerate = async () => {
    if (imageUrls.length === 0) {
      message.warning('请先上传或选择一张图片')
      return
    }
    if (loading) return

    const epId = ensureEndpoint()
    if (!epId) return

    setLoading(true)
    try {
      const systemContent = llmPrompts.charCardPrompt
      const messages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrls[0] } },
          ],
        },
      ]
      const reply = await requestChatCompletion({ endpointId: epId, messages })
      setRawData(reply)
      const raw = extractJsonFromText(reply)
      if (!raw) {
        message.error('未能从 LLM 返回中解析出角色卡 JSON，请查看下方原始数据')
        return
      }
      applyRawJson(raw)
      message.success('角色卡生成成功')
    } catch (error: any) {
      message.error(error.message || '生成角色卡失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setCard(emptyCharacterCard)
    setHasCard(false)
    setRawData('')
    setExtraFields({})
  }

  // ── 导入 ──────────────────────────────────────

  const handleImportJson = (file: any) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const raw = JSON.parse(text)
        applyRawJson(raw)
        message.success('JSON 角色卡导入成功')
      } catch {
        message.error('JSON 解析失败，请检查文件格式')
      }
    }
    reader.readAsText(file)
    return false
  }

  const handleImportPng = (file: any) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer
      try {
        const raw = parsePngCharacterCardRaw(buffer)
        if (!raw) {
          message.error('未在 PNG 中找到角色卡数据')
          return
        }
        applyRawJson(raw)
        // 同时显示 PNG 图片
        const blob = new Blob([buffer], { type: 'image/png' })
        const url = URL.createObjectURL(blob)
        setImageUrls([url])
        message.success('PNG 角色卡导入成功')
      } catch (error: any) {
        message.error(error.message || 'PNG 解析失败')
      }
    }
    reader.readAsArrayBuffer(file)
    return false
  }

  const jsonUploadProps = {
    accept: '.json',
    showUploadList: false as const,
    beforeUpload: handleImportJson,
  }

  const pngUploadProps = {
    accept: '.png',
    showUploadList: false as const,
    beforeUpload: handleImportPng,
  }

  // ── 原始数据提交 ──────────────────────────────

  const handleSubmitRawData = () => {
    const raw = extractJsonFromText(rawData)
    if (!raw) {
      message.error('JSON 格式不正确，请检查原始数据')
      return
    }
    applyRawJson(raw)
    message.success('原始数据已提交到编辑区域')
  }

  // ── 导出 ──────────────────────────────────────

  const handleExportJson = () => {
    if (!hasCard) {
      message.warning('请先生成或导入角色卡')
      return
    }
    try {
      exportCardAsJson(card, extraFields)
      message.success('JSON 导出成功')
    } catch (error: any) {
      message.error(error.message || '导出失败')
    }
  }

  const handleExportPng = async () => {
    if (!hasCard) {
      message.warning('请先生成或导入角色卡')
      return
    }
    if (imageUrls.length === 0) {
      message.warning('导出 PNG 需要一张参考图片')
      return
    }
    const hide = message.loading('正在生成 PNG 角色卡...', 0)
    try {
      await exportCardAsPng(card, imageUrls[0], extraFields)
      hide()
      message.success('PNG 角色卡导出成功')
    } catch (error: any) {
      hide()
      message.error(error.message || '导出失败')
    }
  }

  // ── 渲染 ──────────────────────────────────────

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* 顶部工具栏 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 flex items-center gap-2 text-lg font-semibold text-slate-800">
          <ThunderboltOutlined className="text-emerald-500" /> 角色卡生成
        </h2>
        <div className="flex items-center gap-2">
          {llmEndpoints.length > 0 && (
            <Select
              value={endpointId}
              onChange={setCharCardEndpointId}
              className="min-w-[180px]"
              placeholder="选择 LLM 端点"
              options={llmEndpoints.map((e) => ({
                value: e.id,
                label: e.name || '未命名端点',
              }))}
            />
          )}
          <Tooltip title="LLM 设置">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() =>
                openSettingModal({ initialTab: 'llm-endpoints' })
              }
            />
          </Tooltip>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* 左侧：图片上传 + 操作按钮 */}
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 text-sm font-medium text-slate-600">
              参考图片
            </div>
            <ImageUpload
              value={imageUrls}
              onChange={setImageUrls}
              onUploadingChange={(isUploading) =>
                setUploadingCount(isUploading ? 1 : 0)
              }
            />
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleGenerate}
              loading={loading}
              disabled={uploadingCount > 0 || imageUrls.length === 0}
              className="mt-3 w-full"
              size="large"
            >
              生成角色卡
            </Button>
          </div>

          {/* 导入 */}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 text-sm font-medium text-slate-600">
              导入角色卡
            </div>
            <div className="flex gap-2">
              <Upload {...jsonUploadProps} className="flex-1">
                <Button icon={<FileTextOutlined />} className="w-full">
                  导入 JSON
                </Button>
              </Upload>
              <Upload {...pngUploadProps} className="flex-1">
                <Button icon={<FileImageOutlined />} className="w-full">
                  导入 PNG
                </Button>
              </Upload>
            </div>
          </div>

          {/* 导出 */}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 text-sm font-medium text-slate-600">
              导出角色卡
            </div>
            <div className="flex gap-2">
              <Button
                icon={<DownloadOutlined />}
                onClick={handleExportJson}
                disabled={!hasCard}
                className="flex-1"
              >
                导出 JSON
              </Button>
              <Button
                icon={<DownloadOutlined />}
                onClick={handleExportPng}
                disabled={!hasCard}
                className="flex-1"
              >
                导出 PNG
              </Button>
            </div>
          </div>

          {hasCard && (
            <Button
              icon={<PlusOutlined />}
              onClick={handleClear}
              danger
              type="text"
            >
              清空角色卡
            </Button>
          )}

          {/* 原始数据 */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-600">
                原始数据
              </div>
              <Button
                size="small"
                type="primary"
                onClick={handleSubmitRawData}
                disabled={!rawData}
              >
                提交
              </Button>
            </div>
            <Input.TextArea
              value={rawData}
              onChange={(e) => setRawData(e.target.value)}
              autoSize={{ minRows: 4, maxRows: 20 }}
              style={{ resize: 'none' }}
              placeholder="LLM 原始输出或角色卡 JSON 将显示在此处，编辑后点击「提交」可更新到编辑区域"
            />
          </div>
        </div>

        {/* 右侧：角色卡编辑表单 */}
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {!hasCard ? (
              <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-slate-400">
                <ThunderboltOutlined className="mb-3 text-5xl" />
                <div className="text-base">
                  上传图片后点击「生成角色卡」
                </div>
                <div className="mt-1 text-sm">
                  或导入已有的 JSON / PNG 角色卡进行编辑
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="border-b border-slate-100 pb-2 text-base font-medium text-slate-700">
                  角色卡信息
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">
                    姓名 (name)
                  </label>
                  <Input
                    value={card.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="角色姓名"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">
                    描述 (description)
                  </label>
                  <Input.TextArea
                    value={card.description}
                    onChange={(e) =>
                      updateField('description', e.target.value)
                    }
                    autoSize={{ minRows: 3, maxRows: 10 }}
                    placeholder="外貌描述、服装、显著特征等"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">
                    性格 (personality)
                  </label>
                  <Input.TextArea
                    value={card.personality}
                    onChange={(e) =>
                      updateField('personality', e.target.value)
                    }
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    placeholder="性格特征"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">
                    场景 (scenario)
                  </label>
                  <Input.TextArea
                    value={card.scenario}
                    onChange={(e) => updateField('scenario', e.target.value)}
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    placeholder="初始场景设定"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">
                    第一句话 (first_mes)
                  </label>
                  <Input.TextArea
                    value={card.first_mes}
                    onChange={(e) => updateField('first_mes', e.target.value)}
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    placeholder="角色的第一句话"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">
                    对话示例 (mes_example)
                  </label>
                  <Input.TextArea
                    value={card.mes_example}
                    onChange={(e) =>
                      updateField('mes_example', e.target.value)
                    }
                    autoSize={{ minRows: 3, maxRows: 12 }}
                    placeholder="使用 {{char}} 和 {{user}} 格式的示例对话"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">
                    标签 (tags)
                  </label>
                  <Select
                    mode="tags"
                    value={card.tags}
                    onChange={(value) => updateField('tags', value)}
                    placeholder="输入标签后按回车添加"
                    className="w-full"
                    tokenSeparators={[',']}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
