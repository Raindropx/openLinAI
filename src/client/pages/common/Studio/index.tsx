import {
  DeleteOutlined,
  DownloadOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Dropdown,
  Form,
  Image,
  InputNumber,
  Modal,
  Segmented,
  Spin,
  Tag,
  Tooltip,
  message,
  theme,
} from 'antd'
import { saveAs } from 'file-saver'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  studioFileUrl,
  studioSourceLabel,
  type StudioItem,
} from '../../../../shared/studio'
import type { StudioProviderSettings } from '../../../../shared/studio-generation'
import { useGlobalStore } from '../../../store/global'
import {
  getStudioProviderSettings,
  studioJson,
  studioRequest,
  uploadStudioFile,
} from './api'
import { CivitaiStudio } from './CivitaiStudio'
import { NovelAIStudio } from './NovelAIStudio'
import './studio.css'
import { PHOTOPEA_URL, usePhotopea } from './usePhotopea'

export function StudioPage({ active = true }: { active?: boolean }) {
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const [items, setItems] = useState<StudioItem[]>([])
  const [providerSettings, setProviderSettings] =
    useState<StudioProviderSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('photopea')
  const [mobileShelf, setMobileShelf] = useState(false)
  const [working, setWorking] = useState(false)
  const workingRef = useRef(false)
  const [dragged, setDragged] = useState<string | null>(null)
  const [externalDrag, setExternalDrag] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [preview, setPreview] = useState<StudioItem | null>(null)
  const [width, setWidth] = useState(1024)
  const [height, setHeight] = useState(1024)
  const fileInput = useRef<HTMLInputElement>(null)
  const openAfterImport = useRef(false)
  const [frameKey, setFrameKey] = useState(0)
  const [modal, modalContext] = Modal.useModal()
  const fetchSequence = useRef(0)
  const refresh = useCallback(async () => {
    const sequence = ++fetchSequence.current
    try {
      const list = await studioRequest<StudioItem[]>('/items')
      if (sequence === fetchSequence.current) {
        setItems(list)
        setError('')
      }
    } catch (failure) {
      if (sequence === fetchSequence.current)
        setError(failure instanceof Error ? failure.message : '暂存台读取失败')
    } finally {
      if (sequence === fetchSequence.current) setLoading(false)
    }
  }, [])
  const addItem = (item: StudioItem) => {
    setItems((list) => [item, ...list.filter((entry) => entry.id !== item.id)])
    void refresh()
  }
  const addItems = (added: StudioItem[]) => {
    const ids = new Set(added.map((item) => item.id))
    setItems((list) => [...added, ...list.filter((item) => !ids.has(item.id))])
    void refresh()
  }
  const pick = (open: boolean) => {
    openAfterImport.current = open
    fileInput.current?.click()
  }

  // A keyed child owns the bridge so an explicit reload resets all command state.
  const editorRef = useRef<EditorHandle | null>(null)

  useEffect(() => {
    if (active) {
      void refresh()
      void getStudioProviderSettings()
        .then(setProviderSettings)
        .catch((failure) =>
          message.error(
            failure instanceof Error ? failure.message : '工作室配置读取失败',
          ),
        )
    }
    window.addEventListener('studio-changed', refresh)
    return () => window.removeEventListener('studio-changed', refresh)
  }, [active, refresh])

  async function action(work: () => Promise<void>) {
    if (workingRef.current) return
    workingRef.current = true
    setWorking(true)
    try {
      await work()
      await refresh()
    } catch (failure) {
      message.error(failure instanceof Error ? failure.message : '操作失败')
    } finally {
      workingRef.current = false
      setWorking(false)
    }
  }
  async function importFiles(files: File[], open: boolean) {
    await action(async () => {
      for (const file of files) {
        const item = await uploadStudioFile(file)
        addItem(item)
        if (open) {
          setTab('photopea')
          setMobileShelf(false)
          await editorRef.current?.open(item)
        }
      }
      message.success(`已添加 ${files.length} 个文件到暂存台`)
    })
  }
  const openItem = (item: StudioItem) => {
    setTab('photopea')
    setMobileShelf(false)
    void editorRef.current?.open(item)
  }
  const removeItem = (item: StudioItem) =>
    modal.confirm({
      title: item.pinned ? '删除这份已钉住的素材？' : '删除这份素材？',
      content: '只删除暂存台文件，不影响已归档的作品和已送出的参考图。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () =>
        action(async () => {
          await studioRequest(`/items/${item.id}`, { method: 'DELETE' })
        }),
    })
  const itemAction = (key: string, item: StudioItem) => {
    if (key === 'open') return openItem(item)
    if (key === 'delete') return removeItem(item)
    void action(async () => {
      if (key === 'download') {
        const response = await fetch(studioFileUrl(item.id))
        if (!response.ok) throw new Error('文件下载失败')
        saveAs(await response.blob(), item.name)
      } else if (key === 'archive') {
        await studioRequest(`/items/${item.id}/archive`, { method: 'POST' })
        message.success('已存入任务列表')
      } else if (key === 'reference') {
        const { url } = await studioRequest<{ url: string }>(
          `/items/${item.id}/reference`,
          { method: 'POST' },
        )
        useGlobalStore.getState().addReferenceImage(url)
        navigate('/', { state: { mobilePanel: 'parameters' } })
        message.success('已复制到图片生成参考图')
      }
    })
  }
  const unpinned = items.filter((item) => !item.pinned)
  return (
    <div
      className="studio-layout"
      style={
        {
          color: token.colorText,
          background: token.colorBgLayout,
          '--studio-panel': token.colorBgContainer,
          '--studio-border': token.colorBorder,
          '--studio-muted': token.colorTextSecondary,
        } as React.CSSProperties
      }
    >
      {modalContext}
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,.psd"
        onChange={(event) => {
          const files = Array.from(event.target.files || [])
          event.target.value = ''
          if (files.length) void importFiles(files, openAfterImport.current)
        }}
      />
      <div className="studio-mobile-switch">
        <Segmented
          block
          value={mobileShelf ? 'shelf' : 'editor'}
          options={[
            { label: '工作室', value: 'editor' },
            { label: `暂存台 (${items.length})`, value: 'shelf' },
          ]}
          onChange={(value) => setMobileShelf(value === 'shelf')}
        />
      </div>
      <section
        className={`studio-workspace ${mobileShelf ? 'studio-mobile-hidden' : ''}`}
        aria-label="工作室工具"
      >
        <div className="studio-tabs" role="tablist" aria-label="工作室工具标签">
          {[
            ['novelai', 'NovelAI Image'],
            ['civitai', 'Civitai Image'],
            ['photopea', 'Photopea'],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              aria-controls={`studio-panel-${key}`}
              id={`studio-tab-${key}`}
              onClick={() => setTab(key)}
              className={tab === key ? 'is-active' : ''}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'novelai' && (
          <div
            className="studio-native-panel"
            role="tabpanel"
            id="studio-panel-novelai"
            aria-labelledby="studio-tab-novelai"
          >
            {providerSettings ? (
              <NovelAIStudio
                settings={providerSettings.novelai}
                items={items}
                onSettings={setProviderSettings}
                onItems={addItems}
              />
            ) : (
              <Spin />
            )}
          </div>
        )}
        {tab === 'civitai' && (
          <div
            className="studio-native-panel"
            role="tabpanel"
            id="studio-panel-civitai"
            aria-labelledby="studio-tab-civitai"
          >
            {providerSettings ? (
              <CivitaiStudio
                settings={providerSettings.civitai}
                onSettings={setProviderSettings}
              />
            ) : (
              <Spin />
            )}
          </div>
        )}
        <div
          className="studio-editor-panel"
          style={{ display: tab === 'photopea' ? 'flex' : 'none' }}
          role="tabpanel"
          id="studio-panel-photopea"
          aria-labelledby="studio-tab-photopea"
        >
          <PhotopeaEditor
            key={frameKey}
            handleRef={editorRef}
            onSaved={addItem}
            onNew={() => setNewOpen(true)}
            onOpen={() => pick(true)}
            onReload={() =>
              modal.confirm({
                title: '重新加载 Photopea？',
                content:
                  '编辑器内尚未保存的修改会丢失。暂存台上的文件不受影响。',
                okText: '重新加载',
                cancelText: '取消',
                onOk: () => setFrameKey((key) => key + 1),
              })
            }
            dragged={dragged}
            externalDrag={externalDrag}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes('Files'))
                setExternalDrag(true)
            }}
            onDrop={(event) => {
              event.preventDefault()
              const id = event.dataTransfer.getData(
                'application/x-linai-studio',
              )
              setDragged(null)
              setExternalDrag(false)
              const item = items.find((entry) => entry.id === id)
              if (item) openItem(item)
              else if (event.dataTransfer.files.length)
                void importFiles(Array.from(event.dataTransfer.files), true)
            }}
            onDragLeave={() => setExternalDrag(false)}
          />
        </div>
      </section>
      <aside
        className={`studio-shelf ${mobileShelf ? '' : 'studio-mobile-hidden'}`}
        aria-label="暂存台"
      >
        <header className="studio-shelf-header">
          <div>
            <strong>
              <InboxOutlined /> 暂存台
            </strong>
            <span>
              {items.length} 个文件 ·{' '}
              {items.filter((item) => item.pinned).length} 个钉住
            </span>
          </div>
          <Tooltip title="清理所有未钉住的文件">
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={working || !unpinned.length}
              onClick={() =>
                void action(async () => {
                  const result = await studioRequest<{ removed: number }>(
                    '/empty',
                    studioJson('POST', {
                      ids: unpinned.map((item) => item.id),
                    }),
                  )
                  message.success(
                    `已倒掉 ${result.removed} 个文件，钉住项已保留`,
                  )
                })
              }
            >
              倒掉
            </Button>
          </Tooltip>
        </header>
        <div className="studio-shelf-tools">
          <Button
            icon={<UploadOutlined />}
            onClick={() => pick(false)}
            disabled={working}
          >
            添加文件
          </Button>
          <Button
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => void refresh()}
            aria-label="刷新暂存台"
          />
          <span>PNG / JPG / WebP / GIF / PSD</span>
        </div>
        {error && <Alert type="error" title={error} showIcon />}
        <div className="studio-shelf-list">
          {loading ? (
            <Spin />
          ) : !items.length ? (
            <div className="studio-shelf-empty">
              <InboxOutlined />
              <strong>把素材放在手边</strong>
              <p>
                添加文件，或将图片生成结果复制到这里。Photopea
                保存的作品也会出现在这里。
              </p>
              <Button onClick={() => pick(false)}>添加第一份素材</Button>
            </div>
          ) : (
            items.map((item) => (
              <article
                key={item.id}
                className={`studio-item ${item.pinned ? 'is-pinned' : ''}`}
                draggable={!working}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    'application/x-linai-studio',
                    item.id,
                  )
                  event.dataTransfer.effectAllowed = 'copy'
                  setDragged(item.id)
                }}
                onDragEnd={() => setDragged(null)}
              >
                <button
                  className="studio-item-preview"
                  onClick={() =>
                    item.format === 'psd' ? openItem(item) : setPreview(item)
                  }
                  aria-label={`预览 ${item.name}`}
                >
                  {item.format === 'psd' ? (
                    <span className="studio-psd">PSD</span>
                  ) : (
                    <img
                      src={studioFileUrl(item.id)}
                      alt={item.name}
                      loading="lazy"
                      draggable={false}
                    />
                  )}
                </button>
                <div className="studio-item-info">
                  <div className="studio-item-title">
                    <strong title={item.name}>{item.name}</strong>
                    <Tooltip
                      title={item.pinned ? '取消钉住' : '钉住，倒掉时保留'}
                    >
                      <Button
                        type="text"
                        size="small"
                        aria-label={item.pinned ? '取消钉住' : '钉住'}
                        icon={
                          item.pinned ? <PushpinFilled /> : <PushpinOutlined />
                        }
                        disabled={working}
                        onClick={() =>
                          void action(async () => {
                            await studioRequest(
                              `/items/${item.id}`,
                              studioJson('PATCH', { pinned: !item.pinned }),
                            )
                          })
                        }
                      />
                    </Tooltip>
                  </div>
                  <Tag
                    color={
                      item.provenance.photopea === 'created'
                        ? 'cyan'
                        : item.provenance.photopea === 'edited'
                          ? 'purple'
                          : 'blue'
                    }
                  >
                    {studioSourceLabel(item.provenance)}
                  </Tag>
                  <span className="studio-item-size">
                    {item.format.toUpperCase()} ·{' '}
                    {(item.bytes / 1024 / 1024).toFixed(2)} MiB
                    {item.archivedTaskId ? ' · 已归档' : ''}
                  </span>
                  <div className="studio-item-actions">
                    <Button
                      size="small"
                      disabled={working}
                      onClick={() => openItem(item)}
                    >
                      在 Photopea 打开
                    </Button>
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          {
                            key: 'download',
                            label: '下载文件',
                            icon: <DownloadOutlined />,
                          },
                          {
                            key: 'archive',
                            label:
                              item.format === 'psd'
                                ? '归档需先保存 PNG'
                                : '存入任务列表',
                            disabled: item.format === 'psd',
                            icon: <SaveOutlined />,
                          },
                          {
                            key: 'reference',
                            label: '送到图片生成作参考图',
                            disabled: item.format === 'psd',
                          },
                          { type: 'divider' },
                          {
                            key: 'delete',
                            label: '删除',
                            danger: true,
                            icon: <DeleteOutlined />,
                          },
                        ],
                        onClick: ({ key }) => itemAction(key, item),
                      }}
                    >
                      <Button
                        size="small"
                        icon={<MoreOutlined />}
                        disabled={working}
                        aria-label={`${item.name} 的操作`}
                      />
                    </Dropdown>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
        <footer className="studio-shelf-footer">
          拖到编辑区打开 · 钉住项不会被倒掉
          <br />
          文件会保留到你主动清理
        </footer>
      </aside>
      <Modal
        title="新建 Photopea 文档"
        open={newOpen}
        okText="创建"
        cancelText="取消"
        onCancel={() => setNewOpen(false)}
        onOk={() => {
          if (width * height > 16777216) {
            message.error('画布总像素不能超过 1600 万')
            return
          }
          setNewOpen(false)
          setTab('photopea')
          void editorRef.current?.create(width, height)
        }}
      >
        <Form layout="vertical">
          <Form.Item label="宽度（像素）">
            <InputNumber
              min={1}
              max={8192}
              precision={0}
              value={width}
              onChange={(value) => setWidth(value || 1024)}
            />
          </Form.Item>
          <Form.Item label="高度（像素）">
            <InputNumber
              min={1}
              max={8192}
              precision={0}
              value={height}
              onChange={(value) => setHeight(value || 1024)}
            />
          </Form.Item>
        </Form>
      </Modal>
      {preview && (
        <Image
          style={{ display: 'none' }}
          src={studioFileUrl(preview.id)}
          alt={preview.name}
          preview={{
            open: true,
            onOpenChange: (open) => {
              if (!open) setPreview(null)
            },
          }}
        />
      )}
    </div>
  )
}

type EditorHandle = Pick<ReturnType<typeof usePhotopea>, 'open' | 'create'>
function PhotopeaEditor({
  handleRef,
  onSaved,
  onNew,
  onOpen,
  onReload,
  dragged,
  externalDrag,
  onDragEnter,
  onDrop,
  onDragLeave,
}: {
  handleRef: React.RefObject<EditorHandle | null>
  onSaved: (item: StudioItem) => void
  onNew: () => void
  onOpen: () => void
  onReload: () => void
  dragged: string | null
  externalDrag: boolean
  onDragEnter: React.DragEventHandler
  onDrop: React.DragEventHandler
  onDragLeave: () => void
}) {
  const editor = usePhotopea({ onSaved, onNew, onOpen })
  handleRef.current = editor
  return (
    <>
      <div className="studio-editor-toolbar">
        <Button
          icon={<PlusOutlined />}
          disabled={!editor.ready || editor.busy}
          onClick={onNew}
        >
          新建
        </Button>
        <Button
          icon={<UploadOutlined />}
          disabled={!editor.ready || editor.busy}
          onClick={onOpen}
        >
          打开文件
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={editor.busy}
          disabled={!editor.ready || editor.busy}
          onClick={() => void editor.save('png')}
        >
          保存 PNG 到暂存台
        </Button>
        <Button
          disabled={!editor.ready || editor.busy}
          onClick={() => void editor.save('psd')}
        >
          保存 PSD
        </Button>
        <Button
          type="text"
          icon={<ReloadOutlined />}
          aria-label="重新加载 Photopea"
          onClick={onReload}
          disabled={editor.busy}
        />
        <span>
          {editor.busy
            ? '正在处理…'
            : editor.ready
              ? '保存 / Ctrl+S 返回暂存台'
              : '正在连接 Photopea…'}
        </span>
      </div>
      {editor.connectionError && (
        <Alert title={editor.connectionError} type="warning" showIcon />
      )}
      {editor.recovery && (
        <Alert
          type="error"
          title="文件尚未写入暂存台，编辑结果已暂时保留"
          action={
            <div className="flex gap-2">
              <Button
                onClick={() => void editor.retrySave()}
                loading={editor.busy}
              >
                重试保存
              </Button>
              <Button
                onClick={() => {
                  if (editor.recovery)
                    saveAs(editor.recovery.file, editor.recovery.file.name)
                }}
              >
                下载备份
              </Button>
              <Button onClick={editor.dismissRecovery}>已处理</Button>
            </div>
          }
        />
      )}
      <div className="studio-frame-container" onDragEnter={onDragEnter}>
        <iframe
          src={PHOTOPEA_URL}
          ref={editor.iframeRef}
          title="Photopea 图片编辑器"
          className="studio-frame"
          width="100%"
          height="100%"
          loading="eager"
        />
        {(dragged || externalDrag) && (
          <div
            className="studio-drop-target"
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={onDrop}
            onDragLeave={onDragLeave}
          >
            <InboxOutlined />
            <strong>松开以在 Photopea 打开</strong>
            <span>原文件会保留在暂存台</span>
          </div>
        )}
      </div>
    </>
  )
}
