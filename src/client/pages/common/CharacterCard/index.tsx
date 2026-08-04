import {
  DownloadOutlined,
  FileImageOutlined,
  FileTextOutlined,
  IdcardOutlined,
  PlusOutlined,
  SaveOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { Button, Input, message, Segmented, Select, Tooltip, Upload } from 'antd'
import { hc } from 'hono/client'
import { useState } from 'react'
import type { AppType } from '../../../../server'
import type {
  CharacterCardFormat,
  StoredCharacterCard,
} from '../../../../server/common/character-card-manager'
import { useCharacterCards } from '../../../hooks/useCharacterCards'
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
  imageUrlToPngBuffer,
  normalizeCharacterCard,
  parsePngCharacterCardRaw,
  toV2Format,
  writePngCharacterCard,
  type CharacterCard,
} from '../../../utils/characterCard'
import { openSettingModal } from '../SettingModal'
import { ImageUpload } from '../TemplateSection/TemplateForm/ImageUpload'
import { CharacterCardEditorFields } from './CharacterCardEditorFields'
import { CharacterCardLibrary } from './CharacterCardLibrary'

const client = hc<AppType>('/')

function arrayBufferToDataUrl(buffer: ArrayBuffer) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('PNG 编码失败'))
    reader.readAsDataURL(new Blob([buffer], { type: 'image/png' }))
  })
}

export function CharacterCardPage() {
  const { llmEndpoints, llmPrompts } = useGlobalStore()
  const { charCardEndpointId, setCharCardEndpointId } = useLocalSetting()
  const {
    data: storedCards = [],
    loading: libraryLoading,
    refresh: refreshLibrary,
  } = useCharacterCards()

  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [card, setCard] = useState<CharacterCard>(emptyCharacterCard)
  const [hasCard, setHasCard] = useState(false)
  const [rawData, setRawData] = useState('')
  const [extraFields, setExtraFields] = useState<Record<string, any>>({})
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null)
  const [activeFormat, setActiveFormat] = useState<CharacterCardFormat>('json')
  const [dirty, setDirty] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<
    'generate' | 'editor' | 'library'
  >('editor')

  const endpointId = charCardEndpointId || llmEndpoints[0]?.id

  const updateField = <K extends keyof CharacterCard>(
    key: K,
    value: CharacterCard[K],
  ) => {
    setCard((previous) => ({ ...previous, [key]: value }))
    setDirty(true)
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

  const applyRawJson = (raw: any) => {
    const normalized = normalizeCharacterCard(raw)
    const extra = extractExtraFields(raw)
    setCard(normalized)
    setExtraFields(extra)
    setHasCard(true)
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
      const messages: ChatMessage[] = [
        { role: 'system', content: llmPrompts.charCardPrompt },
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: imageUrls[0] } }],
        },
      ]
      const reply = await requestChatCompletion({ endpointId: epId, messages })
      setRawData(reply)
      const raw = extractJsonFromText(reply)
      if (!raw) {
        message.error('未能从 LLM 返回中解析出角色卡 JSON，请检查原始数据')
        return
      }
      applyRawJson(raw)
      setActiveAssetId(null)
      setActiveFormat('png')
      setDirty(true)
      message.success('角色卡生成成功，可保存到右侧角色卡库')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生成角色卡失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setCard(emptyCharacterCard)
    setHasCard(false)
    setRawData('')
    setExtraFields({})
    setImageUrls([])
    setActiveAssetId(null)
    setActiveFormat('json')
    setDirty(false)
  }

  const handleImportJson = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const raw = JSON.parse(event.target?.result as string)
        applyRawJson(raw)
        setImageUrls([])
        setActiveAssetId(null)
        setActiveFormat('json')
        setDirty(true)
        message.success('JSON 角色卡已载入工作区')
      } catch {
        message.error('JSON 解析失败，请检查文件格式')
      }
    }
    reader.readAsText(file)
    return false
  }

  const handleImportPng = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer
      try {
        const raw = parsePngCharacterCardRaw(buffer)
        if (!raw) {
          message.error('未在 PNG 中找到角色卡数据')
          return
        }
        applyRawJson(raw)
        setImageUrls([
          URL.createObjectURL(new Blob([buffer], { type: 'image/png' })),
        ])
        setActiveAssetId(null)
        setActiveFormat('png')
        setDirty(true)
        message.success('PNG 角色卡已载入工作区')
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'PNG 解析失败')
      }
    }
    reader.readAsArrayBuffer(file)
    return false
  }

  const handleSubmitRawData = () => {
    const raw = extractJsonFromText(rawData)
    if (!raw) {
      message.error('JSON 格式不正确，请检查原始数据')
      return
    }
    applyRawJson(raw)
    setDirty(true)
    message.success('原始数据已提交到编辑区域')
  }

  const handleExportJson = () => {
    if (!hasCard) return message.warning('请先生成或导入角色卡')
    exportCardAsJson(card, extraFields)
    message.success('JSON 导出成功')
  }

  const handleExportPng = async () => {
    if (!hasCard) return message.warning('请先生成或导入角色卡')
    if (imageUrls.length === 0) {
      return message.warning('导出 PNG 需要一张角色图片')
    }
    const hide = message.loading('正在生成 PNG 角色卡...', 0)
    try {
      await exportCardAsPng(card, imageUrls[0], extraFields)
      message.success('PNG 导出成功')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'PNG 导出失败')
    } finally {
      hide()
    }
  }

  const buildPngData = async () => {
    if (!imageUrls[0]) throw new Error('保存 PNG 角色卡需要一张角色图片')
    const png = await imageUrlToPngBuffer(imageUrls[0])
    return arrayBufferToDataUrl(writePngCharacterCard(png, card, extraFields))
  }

  const buildLibraryPayload = async (format: CharacterCardFormat) => ({
    name: card.name || '未命名角色',
    format,
    card: toV2Format(card, extraFields),
    ...(format === 'png' ? { pngData: await buildPngData() } : {}),
  })

  const handleSaveAs = async (format: CharacterCardFormat) => {
    if (!hasCard) return message.warning('请先生成或导入角色卡')
    setSaving(true)
    try {
      const response = await client.api['character-card'].$post({
        json: await buildLibraryPayload(format),
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error || '保存角色卡失败')
      setActiveAssetId(result.data.id)
      setActiveFormat(result.data.format)
      setDirty(false)
      refreshLibrary()
      message.success(`已另存为 ${format.toUpperCase()} 角色卡`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存角色卡失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveCurrent = async () => {
    if (!activeAssetId) {
      message.warning('当前是新草稿，请先选择“另存 JSON”或“另存 PNG”')
      return
    }
    setSaving(true)
    try {
      const response = await client.api['character-card'][':id'].$put({
        param: { id: activeAssetId },
        json: await buildLibraryPayload(activeFormat),
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error || '更新角色卡失败')
      setDirty(false)
      refreshLibrary()
      message.success('当前角色卡已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新角色卡失败')
    } finally {
      setSaving(false)
    }
  }

  const handleLoadStoredCard = (stored: StoredCharacterCard) => {
    applyRawJson(stored.card)
    setImageUrls(
      stored.format === 'png' && stored.imageUrl ? [stored.imageUrl] : [],
    )
    setActiveAssetId(stored.id)
    setActiveFormat(stored.format)
    setDirty(false)
    message.success(`已载入“${stored.name}”`)
  }

  const handleDeleteStoredCard = async (stored: StoredCharacterCard) => {
    try {
      const response = await client.api['character-card'][':id'].$delete({
        param: { id: stored.id },
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error || '删除角色卡失败')
      if (activeAssetId === stored.id) setActiveAssetId(null)
      refreshLibrary()
      message.success('角色卡已删除')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除角色卡失败')
    }
  }

  const handleExportStoredCard = async (stored: StoredCharacterCard) => {
    const storedCard = normalizeCharacterCard(stored.card)
    const storedExtra = extractExtraFields(stored.card)
    if (stored.format === 'png' && stored.imageUrl) {
      await exportCardAsPng(storedCard, stored.imageUrl, storedExtra)
    } else {
      exportCardAsJson(storedCard, storedExtra)
    }
    message.success(`${stored.format.toUpperCase()} 导出成功`)
  }

  return (
    <div className="flex min-h-full flex-col gap-3 p-3 lg:h-full lg:min-h-0 lg:p-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400/10 text-lg text-amber-300 ring-1 ring-amber-400/20">
            <ThunderboltOutlined />
          </div>
          <div>
            <h1 className="m-0 text-lg font-semibold text-slate-100">
              角色卡工作区
            </h1>
            <p className="m-0 mt-0.5 text-xs text-slate-500">
              生成、编辑并管理 SillyTavern JSON / PNG 角色卡
            </p>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {llmEndpoints.length > 0 && (
            <Select
              value={endpointId}
              onChange={setCharCardEndpointId}
              className="min-w-0 flex-1 sm:min-w-[180px]"
              placeholder="选择 LLM 端点"
              options={llmEndpoints.map((endpoint) => ({
                value: endpoint.id,
                label: endpoint.name || '未命名端点',
              }))}
            />
          )}
          <Tooltip title="LLM 设置">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => openSettingModal({ initialTab: 'llm-endpoints' })}
            />
          </Tooltip>
        </div>
      </div>

      <Segmented
        block
        value={mobilePanel}
        onChange={setMobilePanel}
        className="shrink-0 lg:hidden"
        options={[
          { label: '生成', value: 'generate', icon: <ThunderboltOutlined /> },
          { label: '编辑', value: 'editor', icon: <FileTextOutlined /> },
          { label: '角色库', value: 'library', icon: <IdcardOutlined /> },
        ]}
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[300px_minmax(420px,1fr)_320px]">
        <aside
          className={`min-h-[calc(100dvh-16rem)] space-y-3 overflow-y-auto pr-1 lg:block lg:min-h-0 ${mobilePanel === 'generate' ? 'block' : 'hidden'}`}
        >
          <section className="workbench-panel p-3">
            <div className="mb-2 text-sm font-medium text-slate-300">
              参考图片与生成
            </div>
            <ImageUpload
              value={imageUrls}
              onChange={(urls) => {
                setImageUrls(urls)
                setDirty(true)
              }}
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
          </section>

          <section className="workbench-panel p-3">
            <div className="mb-2 text-sm font-medium text-slate-300">
              导入文件
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Upload
                accept=".json"
                showUploadList={false}
                beforeUpload={handleImportJson}
              >
                <Button icon={<FileTextOutlined />} className="w-full">
                  导入 JSON
                </Button>
              </Upload>
              <Upload
                accept=".png"
                showUploadList={false}
                beforeUpload={handleImportPng}
              >
                <Button icon={<FileImageOutlined />} className="w-full">
                  导入 PNG
                </Button>
              </Upload>
            </div>
          </section>

          <section className="workbench-panel p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-300">
                原始数据
              </span>
              <Button
                size="small"
                type="primary"
                onClick={handleSubmitRawData}
                disabled={!rawData}
              >
                应用 JSON
              </Button>
            </div>
            <Input.TextArea
              value={rawData}
              onChange={(event) => {
                setRawData(event.target.value)
                setDirty(true)
              }}
              autoSize={{ minRows: 5, maxRows: 18 }}
              placeholder="LLM 原始输出或角色卡 JSON"
            />
          </section>
        </aside>

        <main
          className={`workbench-panel min-h-[calc(100dvh-16rem)] flex-col lg:flex lg:min-h-0 ${mobilePanel === 'editor' ? 'flex' : 'hidden'}`}
        >
          <div className="workbench-panel-header h-auto! flex-wrap gap-3 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-100">
                {hasCard ? card.name || '未命名角色' : '角色卡编辑器'}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {activeAssetId
                  ? `当前库文件：${activeFormat.toUpperCase()}`
                  : '新角色卡草稿'}
                {dirty && (
                  <span className="ml-2 text-amber-300">有未保存修改</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                icon={<SaveOutlined />}
                disabled={!hasCard || !activeAssetId}
                loading={saving}
                onClick={handleSaveCurrent}
              >
                保存更新
              </Button>
              <Button
                icon={<FileTextOutlined />}
                disabled={!hasCard}
                loading={saving}
                onClick={() => handleSaveAs('json')}
              >
                另存 JSON
              </Button>
              <Button
                type="primary"
                icon={<FileImageOutlined />}
                disabled={!hasCard || imageUrls.length === 0}
                loading={saving}
                onClick={() => handleSaveAs('png')}
              >
                另存 PNG
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!hasCard ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center text-slate-500">
                <ThunderboltOutlined className="mb-3 text-5xl text-slate-600" />
                <div className="text-base text-slate-300">
                  角色卡编辑器等待内容
                </div>
                <div className="mt-1 max-w-sm text-sm leading-6">
                  生成或导入角色卡，也可以从右侧角色卡库载入已有 JSON / PNG。
                </div>
              </div>
            ) : (
              <CharacterCardEditorFields
                card={card}
                endpointId={endpointId}
                onChange={updateField}
              />
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#303640] p-3">
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<DownloadOutlined />}
                onClick={handleExportJson}
                disabled={!hasCard}
              >
                导出 JSON 文件
              </Button>
              <Button
                icon={<DownloadOutlined />}
                onClick={handleExportPng}
                disabled={!hasCard || imageUrls.length === 0}
              >
                导出 PNG 文件
              </Button>
            </div>
            {hasCard && (
              <Button
                danger
                type="text"
                icon={<PlusOutlined />}
                onClick={handleClear}
              >
                新建空白角色卡
              </Button>
            )}
          </div>
        </main>

        <aside
          className={`workbench-panel min-h-[calc(100dvh-16rem)] flex-col lg:flex lg:min-h-0 ${mobilePanel === 'library' ? 'flex' : 'hidden'}`}
        >
          <div className="workbench-panel-header h-auto! gap-3 py-3">
            <span>角色卡库</span>
            <span className="text-xs font-normal text-slate-500">
              {storedCards.length} 张
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <CharacterCardLibrary
              cards={storedCards}
              loading={libraryLoading}
              activeId={activeAssetId}
              onLoad={handleLoadStoredCard}
              onDelete={handleDeleteStoredCard}
              onExport={handleExportStoredCard}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
