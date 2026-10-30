import { PlusOutlined, SettingOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  theme,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { videoModeLabel, type VideoRequest } from '../../../../shared/video'
import {
  VIDEO_ENDPOINT_PRESETS,
  VIDEO_MODEL_CATALOG,
  VIDEO_PROTOCOLS,
  videoEndpointSchema,
  videoOptions,
  type VideoEndpoint,
  type VideoModelOptions,
} from '../../../../shared/video-endpoints'
import { t, useAppLanguage } from '../../../i18n'
import { ModelIdInput } from '../SettingModal/ModelIdInput'
import { studioJson, studioRequest } from './api'

const newEndpoint = (): VideoEndpoint => ({
  id: uuidv4(),
  name: '',
  enabled: true,
  protocol: 'openai-video',
  baseURL: '',
  model: '',
  options: videoOptions(),
  mediaHosts: [],
})
export function VideoEndpointSettings({
  onChanged,
}: {
  onChanged: (id?: string) => void
}) {
  useAppLanguage()
  const { token } = theme.useToken()
  const [open, setOpen] = useState(false)
  const [endpoints, setEndpoints] = useState<VideoEndpoint[]>([])
  const [draft, setDraft] = useState<VideoEndpoint>()
  const [busy, setBusy] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [refreshModels, setRefreshModels] = useState(0)
  const [error, setError] = useState('')
  const [models, setModels] = useState<
    Array<{ id: string; name: string; options?: VideoModelOptions }>
  >([])
  const [dirty, setDirty] = useState(false)
  const modelAttempt = useRef(0)
  const latestDraft = useRef(draft)
  latestDraft.current = draft
  const optionsRevision = useRef(0)
  const [form] = Form.useForm()
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setBusy(true)
    setError('')
    studioRequest<VideoEndpoint[]>('/videos/endpoints')
      .then((data) => {
        if (cancelled) return
        setEndpoints(data)
        setDraft(data[0] || newEndpoint())
        setDirty(false)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause.message)
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
      modelAttempt.current++
    }
  }, [open])
  useEffect(() => {
    if (draft) form.setFieldsValue(draft)
  }, [draft, form])
  const update = (values: Partial<VideoEndpoint>) => {
    if ('baseURL' in values || 'protocol' in values) {
      modelAttempt.current++
      values = {
        ...values,
        apiKey: '',
        apiKeyConfigured: false,
        keyHint: undefined,
      }
    }
    setDraft((current) => (current ? { ...current, ...values } : current))
    setDirty(true)
  }
  const option = (values: Partial<VideoModelOptions>) => {
    optionsRevision.current++
    if (draft) update({ options: { ...draft.options, ...values } })
  }
  const switchDraft = (next: VideoEndpoint | undefined) => {
    const apply = () => {
      modelAttempt.current++
      setLoadingModels(false)
      setDraft(next)
      setModels([])
      setModelsError(null)
      setDirty(false)
      setError('')
      form.resetFields()
    }
    if (dirty)
      Modal.confirm({ title: t('放弃未保存的端点修改？'), onOk: apply })
    else apply()
  }
  const close = () => {
    if (busy) return
    if (dirty)
      Modal.confirm({
        title: t('放弃未保存的端点修改？'),
        onOk: () => setOpen(false),
      })
    else setOpen(false)
  }
  const builtInModels = VIDEO_MODEL_CATALOG.filter(
    (preset) =>
      preset.protocol === draft?.protocol &&
      preset.baseURL.replace(/\/+$/, '') === draft?.baseURL.replace(/\/+$/, ''),
  ).map((preset) => ({
    id: preset.model,
    name: preset.model,
    options: preset.options,
  }))
  const choices = [
    ...new Map(
      [...builtInModels, ...models].map((model) => [model.id, model]),
    ).values(),
  ]
  async function save() {
    if (!draft || busy) return
    try {
      await form.validateFields()
    } catch {
      return
    }
    const parsed = videoEndpointSchema.safeParse(draft)
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('；'),
      )
      return
    }
    modelAttempt.current++
    setLoadingModels(false)
    setBusy(true)
    setError('')
    try {
      const data = await studioRequest<VideoEndpoint[]>(
        '/videos/endpoints',
        studioJson('PUT', draft),
      )
      setEndpoints(data)
      setDraft(data.find((endpoint) => endpoint.id === draft.id))
      setDirty(false)
      message.success(t('视频端点已保存'))
      onChanged(draft.id)
    } catch (cause) {
      setError((cause as Error).message)
      message.error((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // Probe only connection details. A model ID and endpoint name are not prerequisites.
  const discoveryId = draft?.id
  const discoveryProtocol = draft?.protocol
  const discoveryBase = draft?.baseURL.trim() || ''
  const discoveryKey = draft?.apiKey?.trim() || ''
  const discoverySavedKey = draft?.apiKeyConfigured
  useEffect(() => {
    const attempt = ++modelAttempt.current
    setModels([])
    setModelsError(null)
    setLoadingModels(false)
    if (
      !open ||
      !discoveryId ||
      !discoveryProtocol ||
      !/^https:\/\//.test(discoveryBase) ||
      (!discoveryKey && !discoverySavedKey) ||
      discoveryProtocol === 'civitai'
    )
      return
    const controller = new AbortController()
    const revision = optionsRevision.current
    const timer = window.setTimeout(() => {
      setLoadingModels(true)
      studioRequest<typeof models>('/videos/endpoints/models', {
        ...studioJson('POST', {
          id: discoveryId,
          protocol: discoveryProtocol,
          baseURL: discoveryBase,
          apiKey: discoveryKey,
        }),
        signal: controller.signal,
      })
        .then((data) => {
          if (controller.signal.aborted || attempt !== modelAttempt.current)
            return
          setModels(data)
          const current = data.find(
            (model) => model.id === latestDraft.current?.model,
          )
          if (
            current?.options &&
            optionsRevision.current === revision &&
            !endpoints.some((endpoint) => endpoint.id === discoveryId) &&
            JSON.stringify(current.options) !==
              JSON.stringify(latestDraft.current?.options)
          ) {
            setDraft((value) =>
              value?.id === discoveryId
                ? { ...value, options: current.options! }
                : value,
            )
            setDirty(true)
          }
          if (!data.length)
            setModelsError(
              t('未探测到视频模型，可手动填写模型 ID 并设置参数。'),
            )
        })
        .catch((cause) => {
          if (!controller.signal.aborted && attempt === modelAttempt.current)
            setModelsError((cause as Error).message)
        })
        .finally(() => {
          if (!controller.signal.aborted && attempt === modelAttempt.current)
            setLoadingModels(false)
        })
    }, 500)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [
    open,
    discoveryId,
    discoveryProtocol,
    discoveryBase,
    discoveryKey,
    discoverySavedKey,
    refreshModels,
  ])
  const activePreset = VIDEO_ENDPOINT_PRESETS.find(
    (preset) =>
      preset.protocol === draft?.protocol &&
      preset.baseURL.replace(/\/+$/, '') === discoveryBase.replace(/\/+$/, ''),
  )
  const savedDraft = endpoints.some((endpoint) => endpoint.id === draft?.id)
  return (
    <>
      <Button
        size="small"
        icon={<SettingOutlined />}
        onClick={() => setOpen(true)}
      >
        {t('视频端点设置')}
      </Button>
      <Modal
        title={t('视频端点设置')}
        open={open}
        onCancel={close}
        width={920}
        style={{ top: 32 }}
        styles={{
          body: {
            maxHeight: '76vh',
            overflowY: 'auto',
            '--studio-panel': token.colorBgContainer,
            '--studio-border': token.colorBorder,
            '--studio-muted': token.colorTextSecondary,
          } as React.CSSProperties,
        }}
        destroyOnHidden
        footer={
          <Space wrap>
            <Button
              type="primary"
              disabled={!draft}
              loading={busy}
              onClick={() => void save()}
            >
              {t('保存端点')}
            </Button>
            <Button onClick={close}>{t('关闭')}</Button>
          </Space>
        }
      >
        <div className="studio-video-endpoint-title">{t('视频生成端点')}</div>
        <div className="studio-video-endpoint-toolbar">
          <Select
            aria-label={t('选择端点')}
            value={savedDraft ? draft?.id : undefined}
            disabled={busy}
            placeholder={draft ? t('新增端点草稿') : t('选择端点')}
            style={{ flex: 1, minWidth: 160 }}
            options={endpoints.map((endpoint) => ({
              value: endpoint.id,
              label: `${endpoint.name}${endpoint.enabled ? '' : ` (${t('已停用')})`}`,
            }))}
            onChange={(id) =>
              switchDraft(endpoints.find((endpoint) => endpoint.id === id))
            }
          />
          <Button
            icon={<PlusOutlined />}
            disabled={busy}
            onClick={() => switchDraft(newEndpoint())}
          >
            {t('新增')}
          </Button>
          <Select
            aria-label={t('从预设新增')}
            showSearch
            optionFilterProp="label"
            placeholder={t('从预设新增')}
            disabled={busy}
            value={null}
            style={{ minWidth: 200 }}
            options={VIDEO_ENDPOINT_PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.name,
            }))}
            onChange={(id) => {
              const preset = VIDEO_ENDPOINT_PRESETS.find(
                (preset) => preset.id === id,
              )!
              const {
                website: _website,
                needsReview: _review,
                ...fields
              } = preset
              switchDraft({
                ...structuredClone(fields),
                id: uuidv4(),
                apiKey: '',
              })
            }}
          />
          <Button disabled={!draft || busy} onClick={() => void save()}>
            {t('更新')}
          </Button>
        </div>
        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            style={{ marginBottom: 12 }}
          />
        )}
        <Spin spinning={busy && !draft}>
          {draft && (
            <Form
              name="video-endpoint-settings"
              form={form}
              className="studio-video-endpoint-form"
              layout="vertical"
              disabled={busy}
            >
              {!savedDraft && (
                <div className="studio-video-endpoint-hint">
                  {t('新增端点草稿，更新或保存后加入端点列表。')}
                </div>
              )}
              {draft.notes && (
                <Alert
                  type="info"
                  showIcon
                  title={t(draft.notes)}
                  style={{ marginBottom: 12 }}
                />
              )}
              {activePreset?.website && (
                <p>
                  <a
                    href={activePreset.website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('服务商文档')}
                  </a>
                </p>
              )}
              <div className="studio-video-endpoint-columns">
                <section>
                  <div className="studio-video-fields">
                    <Form.Item
                      label={t('端点名称')}
                      name="name"
                      rules={[{ required: true }]}
                    >
                      <Input
                        value={draft.name}
                        onChange={(event) =>
                          update({ name: event.target.value })
                        }
                      />
                    </Form.Item>
                    <Form.Item label={t('启用端点')}>
                      <Switch
                        checked={draft.enabled}
                        onChange={(enabled) => update({ enabled })}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label={t('接口协议')}>
                    <Select
                      value={draft.protocol}
                      options={Object.entries(VIDEO_PROTOCOLS).map(
                        ([value, label]) => ({ value, label }),
                      )}
                      onChange={(protocol) => {
                        update({ protocol, apiKey: '' })
                        setModels([])
                      }}
                    />
                  </Form.Item>
                  <Form.Item
                    label="API Base URL"
                    name="baseURL"
                    rules={[{ required: true }, { type: 'url' }]}
                  >
                    <Input
                      value={draft.baseURL}
                      onChange={(event) =>
                        update({ baseURL: event.target.value })
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    label="API Key"
                    htmlFor="video-endpoint-settings-api-key"
                    extra={
                      draft.apiKeyConfigured
                        ? t('已保存 {0}；留空保留原密钥', [draft.keyHint])
                        : t('密钥仅保存在服务端，读取设置时不会返回明文')
                    }
                  >
                    <Input.Password
                      id="video-endpoint-settings-api-key"
                      autoComplete="new-password"
                      value={draft.apiKey || ''}
                      onChange={(event) =>
                        update({ apiKey: event.target.value })
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('模型 ID')}
                    name="model"
                    rules={[{ required: true }]}
                  >
                    <ModelIdInput
                      value={draft.model}
                      models={choices}
                      loading={loadingModels}
                      error={modelsError}
                      onRefresh={() => setRefreshModels((value) => value + 1)}
                      waitingForKey={!draft.apiKey && !draft.apiKeyConfigured}
                      directoryLabel={t('视频模型目录')}
                      placeholder={t('搜索或输入视频模型 ID')}
                      onChange={(model) => {
                        const choice = choices.find(
                          (choice) => choice.id === model,
                        )
                        update({
                          model,
                          ...(choice?.options
                            ? { options: structuredClone(choice.options) }
                            : {}),
                        })
                      }}
                    />
                  </Form.Item>
                  <Button
                    loading={loadingModels}
                    disabled={
                      busy ||
                      draft.protocol === 'civitai' ||
                      !draft.baseURL ||
                      (!draft.apiKey && !draft.apiKeyConfigured)
                    }
                    onClick={() => setRefreshModels((value) => value + 1)}
                  >
                    {t('刷新模型目录')}
                  </Button>
                  <div className="studio-video-endpoint-hint">
                    {t(
                      draft.protocol === 'civitai'
                        ? '此服务使用内置模型候选，可手动填写模型 ID 和调整参数。'
                        : '填写地址和 Key 后自动探测视频模型；目录不可用或未收录时，可直接填写模型 ID 和参数。',
                    )}
                  </div>
                  <Form.Item
                    label={t('视频与参考素材域名')}
                    extra={t(
                      '填写结果视频、重定向 CDN 和参考素材的精确域名；每项一个域名，不包含 https://。',
                    )}
                    style={{ marginTop: 12 }}
                  >
                    <Select
                      mode="tags"
                      tokenSeparators={[',', ' ', '\n']}
                      value={draft.mediaHosts}
                      onChange={(mediaHosts) => update({ mediaHosts })}
                    />
                  </Form.Item>
                  {draft.protocol === 'civitai' && (
                    <Form.Item>
                      <Checkbox
                        checked={draft.allowMatureContent}
                        onChange={(event) =>
                          update({ allowMatureContent: event.target.checked })
                        }
                      >
                        {t('允许 Civitai 返回成熟内容')}
                      </Checkbox>
                    </Form.Item>
                  )}
                </section>
                <section>
                  <h3 className="studio-video-endpoint-section-title">
                    {t('模型能力与参数')}
                  </h3>
                  <div className="studio-video-endpoint-options">
                    <Form.Item label={t('生成模式')}>
                      <Checkbox.Group
                        value={draft.options.generationTypes}
                        options={(
                          [
                            'text_to_video',
                            'image_to_video',
                            'reference_to_video',
                          ] as VideoRequest['generationType'][]
                        ).map((value) => ({
                          value,
                          label: t(videoModeLabel(value)),
                        }))}
                        onChange={(generationTypes) =>
                          option({
                            generationTypes:
                              generationTypes as VideoRequest['generationType'][],
                          })
                        }
                      />
                    </Form.Item>
                    <Form.Item label={t('关键帧模式')}>
                      <Checkbox.Group
                        value={draft.options.frameModes || []}
                        options={[
                          { value: 'first_frame', label: t('首帧') },
                          { value: 'first_last_frame', label: t('首尾帧') },
                        ]}
                        onChange={(value) =>
                          option({
                            frameModes: value.length
                              ? (value as VideoModelOptions['frameModes'])
                              : undefined,
                          })
                        }
                      />
                    </Form.Item>
                    <Form.Item label={t('时长（秒）')}>
                      <Select
                        mode="tags"
                        maxTagCount={3}
                        tokenSeparators={[',', ' ']}
                        value={draft.options.durations.map(String)}
                        onChange={(values) =>
                          option({
                            durations: values
                              .map(Number)
                              .filter(
                                (value) =>
                                  Number.isInteger(value) &&
                                  value > 0 &&
                                  value <= 600,
                              ),
                          })
                        }
                      />
                    </Form.Item>
                    <Form.Item label={t('分辨率')}>
                      <Select
                        mode="tags"
                        maxTagCount={3}
                        value={draft.options.resolutions}
                        onChange={(resolutions) => option({ resolutions })}
                      />
                    </Form.Item>
                    <Form.Item label={t('画面比例')}>
                      <Select
                        mode="tags"
                        maxTagCount={3}
                        value={draft.options.aspectRatios}
                        onChange={(aspectRatios) => option({ aspectRatios })}
                      />
                    </Form.Item>
                    <div className="studio-video-fields">
                      <Form.Item label={t('最多输入图片')}>
                        <InputNumber
                          min={0}
                          max={16}
                          value={draft.options.maxImages}
                          onChange={(value) =>
                            option({ maxImages: value ?? 0 })
                          }
                        />
                      </Form.Item>
                      <Form.Item label={t('提示词长度上限')}>
                        <InputNumber
                          min={1}
                          max={20000}
                          value={draft.options.maxPromptLength}
                          onChange={(value) =>
                            option({ maxPromptLength: value ?? 7000 })
                          }
                        />
                      </Form.Item>
                    </div>
                    {draft.options.generationTypes.includes(
                      'reference_to_video',
                    ) && (
                      <div className="studio-video-fields">
                        {(
                          [
                            'maxImages',
                            'maxVideos',
                            'maxAudio',
                            'maxTotalFiles',
                          ] as const
                        ).map((key, index) => (
                          <Form.Item
                            key={key}
                            label={t(
                              [
                                '参考图片上限',
                                '参考视频上限',
                                '参考音频上限',
                                '参考素材总上限',
                              ][index],
                            )}
                          >
                            <InputNumber
                              min={key === 'maxTotalFiles' ? 1 : 0}
                              max={key === 'maxTotalFiles' ? 24 : 16}
                              value={
                                draft.options.references?.[key] ??
                                (key === 'maxTotalFiles'
                                  ? 9
                                  : key === 'maxImages'
                                    ? 9
                                    : 0)
                              }
                              onChange={(value) =>
                                option({
                                  references: {
                                    maxImages: 9,
                                    maxVideos: 0,
                                    maxAudio: 0,
                                    maxTotalFiles: 9,
                                    ...draft.options.references,
                                    [key]: value ?? 0,
                                  },
                                })
                              }
                            />
                          </Form.Item>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
              <Button
                danger
                disabled={
                  busy ||
                  !endpoints.some((endpoint) => endpoint.id === draft.id)
                }
                style={{ marginTop: 16 }}
                onClick={() =>
                  Modal.confirm({
                    title: t('删除视频端点？'),
                    content: t(
                      '有关联任务的端点只能停用，保留查询和取回能力。',
                    ),
                    okButtonProps: { danger: true },
                    onOk: async () => {
                      setBusy(true)
                      try {
                        const data = await studioRequest<VideoEndpoint[]>(
                          `/videos/endpoints/${draft.id}`,
                          studioJson('DELETE', {}),
                        )
                        setEndpoints(data)
                        setDraft(data[0] || newEndpoint())
                        setDirty(false)
                        form.resetFields()
                        onChanged()
                      } catch (cause) {
                        setError((cause as Error).message)
                        throw cause
                      } finally {
                        setBusy(false)
                      }
                    },
                  })
                }
              >
                {t('删除端点')}
              </Button>
            </Form>
          )}
        </Spin>
      </Modal>
    </>
  )
}
