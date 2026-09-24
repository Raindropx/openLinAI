import {
  DeleteOutlined,
  LinkOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Progress,
  Select,
  Switch,
  Tag,
  message,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  CIVITAI_SAMPLERS,
  CIVITAI_SCHEDULES,
  CIVITAI_STATUS_LABELS,
  civitaiEcosystem,
  type CivitaiGenerateRequest,
  type CivitaiResource,
  type CivitaiStudioJob,
} from '../../../../shared/civitai-generation'
import { studioFileUrl, type StudioItem } from '../../../../shared/studio'
import type {
  CivitaiModelSearchResult,
  StudioProviderSettings,
} from '../../../../shared/studio-generation'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import {
  estimateCivitaiGeneration,
  listCivitaiJobs,
  pollCivitaiJob,
  searchCivitaiModels,
  submitCivitaiGeneration,
  testStudioProvider,
  updateCivitaiSettings,
} from './api'
import { ProviderKeyCard } from './ProviderKeyCard'
import type { StudioGenerationParameters } from './studio-parameters'

interface SearchValues {
  query?: string
  type?: string
  baseModel?: string
  sort: string
  favorites: boolean
}

const INITIAL_GENERATION = {
  prompt: '',
  negativePrompt: '',
  width: 1024,
  height: 1024,
  steps: 25,
  scale: 7,
  sampler: 'euler',
  schedule: 'discrete',
  seed: -1,
  n: 1,
  clipSkip: 2,
  strength: 0.7,
  allowMatureContent: false,
} satisfies Partial<CivitaiGenerateRequest>

export function CivitaiStudio({
  settings,
  onSettings,
  onItems,
  items,
  incomingParameters,
  incomingReference,
}: {
  settings: StudioProviderSettings['civitai']
  onSettings: (settings: StudioProviderSettings) => void
  onItems: (items: StudioItem[]) => void
  items: StudioItem[]
  incomingParameters?: { id: number; values: StudioGenerationParameters }
  incomingReference?: { id: number; itemId: string }
}) {
  const [form] = Form.useForm<SearchValues>()
  const [generationForm] = Form.useForm<CivitaiGenerateRequest>()
  const { gptImageSettings } = useLocalSetting()
  const [model, setModel] = useState<CivitaiResource>()
  const [loras, setLoras] = useState<CivitaiGenerateRequest['loras']>([])
  const [busy, setBusy] = useState<'estimate' | 'submit'>()
  const [estimate, setEstimate] = useState<{ cost: number; key: string }>()
  const [jobs, setJobs] = useState<CivitaiStudioJob[]>([])
  const [jobsLoaded, setJobsLoaded] = useState(false)
  const [jobError, setJobError] = useState('')
  const [polling, setPolling] = useState(true)
  const onItemsRef = useRef(onItems)
  onItemsRef.current = onItems
  const delivered = useRef(new Set<string>())
  const submission = useRef<
    { id: string; request: CivitaiGenerateRequest } | undefined
  >(undefined)
  const busyRef = useRef(false)
  const watched = Form.useWatch([], generationForm)
  const [referenceItemId, setReferenceItemId] = useState<string>()
  const [result, setResult] = useState<CivitaiModelSearchResult>({ items: [] })
  const [loading, setLoading] = useState(false)
  const referenceItem = items.find((item) => item.id === referenceItemId)
  const activeJob = jobs.find((job) => !job.settled)
  const estimateKey = JSON.stringify({ watched, model, loras, referenceItemId })

  const receiveJob = (job: CivitaiStudioJob) => {
    if (submission.current?.id === job.id) submission.current = undefined
    setJobs((current) =>
      [job, ...current.filter((entry) => entry.id !== job.id)]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20),
    )
    const added = job.items.filter((item) => !delivered.current.has(item.id))
    if (added.length) {
      added.forEach((item) => delivered.current.add(item.id))
      onItemsRef.current(added)
    }
  }

  useEffect(() => {
    let disposed = false
    setJobsLoaded(false)
    if (settings.configured)
      void listCivitaiJobs()
        .then((list) => {
          if (!disposed) {
            setJobs(list)
            setJobsLoaded(true)
          }
        })
        .catch((error) => {
          if (!disposed)
            setJobError(
              error instanceof Error ? error.message : '生成记录读取失败',
            )
        })
    return () => {
      disposed = true
    }
  }, [settings.configured])

  useEffect(() => {
    if (!activeJob || !settings.configured || !polling) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let failures = 0
    let attempts = 0
    const poll = async () => {
      try {
        const next = await pollCivitaiJob(activeJob.id)
        if (disposed) return
        receiveJob(next)
        setJobError('')
        failures = 0
        if (next.settled) return
        // Unknown submission and local save failures need deliberate recovery.
        if (next.status === 'unknown' || next.error) {
          setPolling(false)
          return
        }
      } catch (error) {
        if (disposed) return
        failures++
        setJobError(error instanceof Error ? error.message : '进度查询失败')
        if (failures >= 3) {
          setPolling(false)
          return
        }
      }
      attempts++
      timer = setTimeout(
        () => void poll(),
        Math.min(30000, 2000 + attempts * 3000),
      )
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [activeJob?.id, settings.configured, polling])

  useEffect(() => {
    if (!incomingParameters) return
    generationForm.resetFields()
    const { civitai, ...common } = incomingParameters.values
    if (civitai) {
      generationForm.setFieldsValue(civitai)
      setModel(civitai.model)
      setLoras(civitai.loras)
      setReferenceItemId(civitai.referenceItemId)
    } else {
      const sampler = common.sampler
      generationForm.setFieldsValue({
        ...common,
        sampler: CIVITAI_SAMPLERS.includes(
          sampler as (typeof CIVITAI_SAMPLERS)[number],
        )
          ? (sampler as (typeof CIVITAI_SAMPLERS)[number])
          : INITIAL_GENERATION.sampler,
      })
    }
    setEstimate(undefined)
  }, [generationForm, incomingParameters])

  useEffect(() => {
    if (incomingReference) setReferenceItemId(incomingReference.itemId)
  }, [incomingReference])

  async function generate(estimateOnly: boolean) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(estimateOnly ? 'estimate' : 'submit')
    try {
      if (!settings.configured) throw new Error('请先保存 Civitai API Key')
      if (!model) throw new Error('请先从右侧选择一个 Checkpoint 版本')
      if (referenceItemId && !referenceItem)
        throw new Error('参考图已不在暂存台，请重新选择或清除')
      const values = await generationForm.validateFields()
      const request: CivitaiGenerateRequest = {
        ...INITIAL_GENERATION,
        ...values,
        model,
        loras,
        referenceItemId,
        saveToTaskList: gptImageSettings.autoSaveStudioTasksToTaskList ?? false,
      }
      if (estimateOnly) {
        const result = await estimateCivitaiGeneration(request)
        setEstimate({ ...result, key: estimateKey })
      } else {
        submission.current = { id: submission.current?.id || uuidv4(), request }
        const job = await submitCivitaiGeneration(
          submission.current.id,
          submission.current.request,
        )
        submission.current = undefined
        receiveJob(job)
        setJobError('')
        setPolling(job.status !== 'unknown')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '请检查生成参数'
      if (!estimateOnly && submission.current) {
        setJobError(
          `${detail}；提交结果未确认，再次点击会使用同一编号查询或提交，避免重复生成。`,
        )
        // The server persists jobs before the paid request, so refreshing can recover them.
        void listCivitaiJobs()
          .then(setJobs)
          .catch(() => {})
      } else message.error(detail)
    } finally {
      busyRef.current = false
      setBusy(undefined)
    }
  }

  function selectVersion(resource: CivitaiResource) {
    if (resource.type === 'Checkpoint') {
      setModel(resource)
      setLoras((current) =>
        current.filter((lora) => lora.baseModel === resource.baseModel),
      )
    } else {
      if (!model) return void message.warning('请先选择主模型')
      if (resource.baseModel !== model.baseModel)
        return void message.warning('LoRA 与主模型的基础模型必须一致')
      setLoras((current) =>
        current.some((lora) => lora.versionId === resource.versionId)
          ? current
          : [...current, { ...resource, strength: 1 }].slice(0, 10),
      )
    }
  }

  async function search(cursor?: string, append = false) {
    if (!settings.configured) {
      message.warning('请先保存 Civitai API Key')
      return
    }
    const values = await form.validateFields()
    setLoading(true)
    try {
      const next = await searchCivitaiModels({
        ...values,
        cursor,
        limit: 20,
      })
      setResult((current) => ({
        items: append ? [...current.items, ...next.items] : next.items,
        nextCursor: next.nextCursor,
      }))
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Civitai 搜索失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="studio-civitai-workbench">
      <aside className="studio-civitai-parameters">
        <header className="studio-novelai-parameters-header">
          <strong>Civitai 生成参数</strong>
          <span>GENERATION</span>
        </header>
        <div className="studio-novelai-parameters-scroll">
          <div className="studio-civitai-selected-model">
            <strong>主模型</strong>
            <span>{model?.name || '从模型目录选择 Checkpoint 版本'}</span>
            {model && <Tag>{model.baseModel}</Tag>}
          </div>
          {loras.map((lora) => (
            <div className="studio-civitai-lora" key={lora.versionId}>
              <span title={lora.name}>{lora.name}</span>
              <InputNumber
                aria-label={`${lora.name} 权重`}
                min={-2}
                max={2}
                step={0.1}
                value={lora.strength}
                onChange={(strength) =>
                  setLoras((current) =>
                    current.map((entry) =>
                      entry.versionId === lora.versionId
                        ? { ...entry, strength: strength ?? 1 }
                        : entry,
                    ),
                  )
                }
              />
              <Button
                aria-label={`移除 ${lora.name}`}
                icon={<DeleteOutlined />}
                onClick={() =>
                  setLoras((current) =>
                    current.filter(
                      (entry) => entry.versionId !== lora.versionId,
                    ),
                  )
                }
              />
            </div>
          ))}
          <Form
            form={generationForm}
            layout="vertical"
            initialValues={INITIAL_GENERATION}
            className="studio-generation-form"
          >
            <Form.Item
              label="提示词"
              name="prompt"
              rules={[
                { required: true, whitespace: true, message: '请输入提示词' },
              ]}
            >
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 10 }}
                maxLength={10000}
              />
            </Form.Item>
            <Form.Item label="负面提示词" name="negativePrompt">
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
            </Form.Item>
            <div className="studio-form-grid studio-form-grid-wide">
              <Form.Item label="宽度" name="width" rules={[{ required: true }]}>
                <InputNumber min={64} max={2048} step={64} precision={0} />
              </Form.Item>
              <Form.Item
                label="高度"
                name="height"
                rules={[{ required: true }]}
              >
                <InputNumber min={64} max={2048} step={64} precision={0} />
              </Form.Item>
              <Form.Item label="步数" name="steps" rules={[{ required: true }]}>
                <InputNumber min={1} max={150} precision={0} />
              </Form.Item>
              <Form.Item label="采样器" name="sampler">
                <Select
                  options={CIVITAI_SAMPLERS.map((value) => ({
                    label: value,
                    value,
                  }))}
                />
              </Form.Item>
              <Form.Item label="调度器" name="schedule">
                <Select
                  options={CIVITAI_SCHEDULES.map((value) => ({
                    label: value,
                    value,
                  }))}
                />
              </Form.Item>
              <Form.Item label="CFG" name="scale" rules={[{ required: true }]}>
                <InputNumber min={0} max={30} step={0.1} />
              </Form.Item>
              <Form.Item
                label="种子（-1 随机）"
                name="seed"
                rules={[{ required: true }]}
              >
                <InputNumber min={-1} max={0x7fffffff} precision={0} />
              </Form.Item>
              <Form.Item label="张数" name="n">
                <InputNumber min={1} max={4} precision={0} />
              </Form.Item>
              {model && civitaiEcosystem(model.baseModel) === 'sd1' && (
                <Form.Item label="Clip Skip" name="clipSkip">
                  <InputNumber min={1} max={12} precision={0} />
                </Form.Item>
              )}
              <Form.Item label="重绘强度" name="strength">
                <InputNumber
                  min={0}
                  max={1}
                  step={0.05}
                  disabled={!referenceItemId}
                />
              </Form.Item>
            </div>
            <Form.Item
              label="允许 Mature 内容（使用黄色 Buzz）"
              name="allowMatureContent"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Form>
          <div
            className="studio-reference-section"
            onDragOver={(event) => {
              if (
                !event.dataTransfer.types.includes('application/x-linai-studio')
              )
                return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(event) => {
              const itemId = event.dataTransfer.getData(
                'application/x-linai-studio',
              )
              const item = items.find((entry) => entry.id === itemId)
              if (!item || item.format === 'psd') return
              event.preventDefault()
              setReferenceItemId(item.id)
            }}
          >
            <div className="studio-section-heading">
              <div>
                <strong>图生图参考图</strong>
                <small>
                  选择后启用图生图，参考图将发送给 Civitai；清除后恢复文生图
                </small>
              </div>
            </div>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="从暂存台选择"
              value={referenceItemId}
              options={items.map((item) => ({
                label: item.name,
                value: item.id,
                disabled: item.format === 'psd',
              }))}
              onChange={setReferenceItemId}
            />
            {referenceItem ? (
              <div className="studio-reference-preview">
                <img
                  src={studioFileUrl(referenceItem.id)}
                  alt={referenceItem.name}
                />
                <div>
                  <strong>{referenceItem.name}</strong>
                  <span>来源：暂存台</span>
                </div>
              </div>
            ) : (
              <div className="studio-reference-empty">
                拖入暂存台图片作为参考图
              </div>
            )}
          </div>
          <div className="studio-civitai-generate-actions">
            <Button
              block
              loading={busy === 'estimate'}
              disabled={!settings.configured || !model || !!busy}
              onClick={() => void generate(true)}
            >
              预估 Buzz
            </Button>
            {estimate?.key === estimateKey && (
              <span>预估 {estimate.cost} Buzz · 以实际扣费为准</span>
            )}
            <Button
              type="primary"
              block
              icon={<ThunderboltOutlined />}
              loading={busy === 'submit'}
              disabled={
                !settings.configured ||
                !jobsLoaded ||
                !model ||
                !!busy ||
                !!activeJob
              }
              onClick={() => void generate(false)}
            >
              {submission.current ? '恢复 / 重试提交' : '生成图片'}
            </Button>
          </div>
          {jobError && <Alert type="warning" showIcon title={jobError} />}
          {!jobsLoaded && settings.configured && (
            <Button
              onClick={() =>
                void listCivitaiJobs()
                  .then((list) => {
                    setJobs(list)
                    setJobsLoaded(true)
                    setJobError('')
                  })
                  .catch((error) =>
                    setJobError(
                      error instanceof Error
                        ? error.message
                        : '生成记录读取失败',
                    ),
                  )
              }
            >
              重新读取生成记录
            </Button>
          )}
          {activeJob && !polling && (
            <Button
              block
              onClick={() => {
                setPolling(true)
                setJobError('')
              }}
            >
              继续查询结果
            </Button>
          )}
          {jobs.slice(0, 5).map((job) => (
            <div className="studio-civitai-job" key={job.id}>
              <div>
                <strong>
                  {CIVITAI_STATUS_LABELS[job.status] || job.status}
                </strong>
                <span>
                  {new Date(job.createdAt).toLocaleTimeString()}
                  {job.cost !== undefined ? ` · ${job.cost} Buzz` : ''}
                </span>
              </div>
              {!job.settled && job.progress !== undefined && (
                <Progress percent={job.progress} size="small" />
              )}
              {job.error && <Alert type="error" title={job.error} />}
              {job.warning && <Alert type="warning" title={job.warning} />}
              {job.items.length > 0 && (
                <span>已保存 {job.items.length} 张到暂存台</span>
              )}
            </div>
          ))}
        </div>
      </aside>
      <div className="studio-provider-panel studio-civitai-catalog">
        <ProviderKeyCard
          provider="Civitai"
          configured={settings.configured}
          keyHint={settings.keyHint}
          onSave={async (apiKey) =>
            onSettings(await updateCivitaiSettings({ apiKey }))
          }
          onClear={async () =>
            onSettings(await updateCivitaiSettings({ clearApiKey: true }))
          }
          onTest={async () => {
            const result = await testStudioProvider('civitai')
            return result.username
          }}
        />
        <Alert
          showIcon
          type="info"
          title="选择模型版本后生成"
          description="支持 SD 1.x、SDXL、Pony、Illustrious / NoobAI 的 Checkpoint 与同基础模型 LoRA。生成消耗 Civitai Buzz，可先预估；结果自动进入暂存台。"
        />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ sort: 'Highest Rated', favorites: false }}
          className="studio-civitai-search"
        >
          <div className="studio-form-grid studio-form-grid-search">
            <Form.Item label="搜索" name="query">
              <Input placeholder="模型、LoRA 或作者关键词" allowClear />
            </Form.Item>
            <Form.Item label="类型" name="type">
              <Select
                allowClear
                placeholder="全部类型"
                options={[
                  'Checkpoint',
                  'LORA',
                  'LoCon',
                  'LyCORIS',
                  'TextualInversion',
                  'VAE',
                  'Controlnet',
                ].map((value) => ({ label: value, value }))}
              />
            </Form.Item>
            <Form.Item label="基础模型" name="baseModel">
              <Input placeholder="例如 Illustrious、SDXL 1.0" allowClear />
            </Form.Item>
            <Form.Item label="排序" name="sort">
              <Select
                options={['Highest Rated', 'Most Downloaded', 'Newest'].map(
                  (value) => ({ label: value, value }),
                )}
              />
            </Form.Item>
          </div>
          <div className="studio-search-actions">
            <Form.Item name="favorites" valuePropName="checked" noStyle>
              <Switch checkedChildren="仅收藏" unCheckedChildren="全部模型" />
            </Form.Item>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={loading}
              disabled={!settings.configured}
              onClick={() => void search()}
            >
              搜索模型
            </Button>
          </div>
        </Form>
        {!result.items.length ? (
          <Empty description="设置 Key 后搜索可在线生成的 Checkpoint 与 LoRA" />
        ) : (
          <div className="studio-model-grid">
            {result.items.map((model) => (
              <Card
                key={model.id}
                size="small"
                className="studio-model-card"
                cover={
                  model.imageUrl ? (
                    <img
                      src={model.imageUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : undefined
                }
                actions={[
                  <a
                    key="open"
                    href={`https://civitai.com/models/${model.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <LinkOutlined /> 查看 Civitai
                  </a>,
                ]}
              >
                <Card.Meta
                  title={model.name}
                  description={model.creator ? `@${model.creator}` : '未知作者'}
                />
                <div className="studio-model-tags">
                  <Tag>{model.type}</Tag>
                  {model.nsfw && <Tag color="warning">Mature</Tag>}
                </div>
                <div className="studio-model-versions">
                  {model.versions.map((version) => (
                    <div key={version.id}>
                      <strong>{version.name}</strong>
                      <span>{version.baseModel}</span>
                      {version.trainedWords.length > 0 && (
                        <small title={version.trainedWords.join(', ')}>
                          触发词：{version.trainedWords.slice(0, 3).join(', ')}
                        </small>
                      )}
                      {['Checkpoint', 'LORA', 'LoCon'].includes(model.type) && (
                        <Button
                          size="small"
                          disabled={
                            !version.supportsGeneration ||
                            !civitaiEcosystem(version.baseModel)
                          }
                          onClick={() =>
                            selectVersion({
                              modelId: model.id,
                              versionId: version.id,
                              name: `${model.name} · ${version.name}`,
                              baseModel: version.baseModel,
                              type: model.type as CivitaiResource['type'],
                            })
                          }
                        >
                          {!version.supportsGeneration
                            ? '不可在线生成'
                            : !civitaiEcosystem(version.baseModel)
                              ? '暂不支持此基础模型'
                              : model.type === 'Checkpoint'
                                ? '使用此模型'
                                : '添加 LoRA'}
                        </Button>
                      )}
                      {version.trainedWords.length > 0 && (
                        <Button
                          size="small"
                          type="text"
                          onClick={() =>
                            generationForm.setFieldValue(
                              'prompt',
                              [
                                generationForm.getFieldValue('prompt'),
                                ...version.trainedWords,
                              ]
                                .filter(Boolean)
                                .join(', '),
                            )
                          }
                        >
                          加入触发词
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
        {result.nextCursor && (
          <Button
            block
            loading={loading}
            onClick={() => void search(result.nextCursor, true)}
          >
            加载更多
          </Button>
        )}
      </div>
    </div>
  )
}
