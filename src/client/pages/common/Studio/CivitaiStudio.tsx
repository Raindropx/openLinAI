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
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Segmented,
  Select,
  Switch,
  Tag,
  message,
  theme,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  CIVITAI_SAMPLERS,
  CIVITAI_SCHEDULES,
  CIVITAI_STATUS_LABELS,
  civitaiEcosystem,
  civitaiSiteBaseUrl,
  type CivitaiGenerateRequest,
  type CivitaiResource,
  type CivitaiSite,
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
import { NovelAICanvas } from './NovelAICanvas'
import type { StudioGenerationParameters } from './studio-parameters'
import { PRESET_FIELDS, PresetSaveButton, type PresetField, type StudioPreset } from './studio-presets'

interface SearchValues {
  query?: string
  type?: string
  baseModel?: string
  sort: string
  favorites: boolean
  supportsGeneration: boolean
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
  incomingPreset,
  onSavePreset,
  selectedItemId,
  mobilePanel,
  onMobilePanel,
}: {
  settings: StudioProviderSettings['civitai']
  onSettings: (settings: StudioProviderSettings) => void
  onItems: (items: StudioItem[]) => void
  items: StudioItem[]
  incomingParameters?: { id: number; values: StudioGenerationParameters }
  incomingReference?: { id: number; itemId: string }
  incomingPreset?: { id: number; preset: StudioPreset }
  onSavePreset: (preset: StudioPreset) => boolean
  selectedItemId?: string
  mobilePanel: 'parameters' | 'canvas'
  onMobilePanel: (panel: 'parameters' | 'canvas') => void
}) {
  const [form] = Form.useForm<SearchValues>()
  const [generationForm] = Form.useForm<CivitaiGenerateRequest>()
  const touchedPresetFields = useRef(new Set<PresetField>())
  const { token } = theme.useToken()
  const { gptImageSettings } = useLocalSetting()
  const [site, setSite] = useState<CivitaiSite>('com')
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
  const [viewSource, setViewSource] = useState(false)
  const [result, setResult] = useState<CivitaiModelSearchResult>({ items: [] })
  const [loading, setLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [resolvingLora, setResolvingLora] = useState(false)
  const searchSequence = useRef(0)
  const referenceItem = items.find((item) => item.id === referenceItemId)
  const selectedItem = items.find((item) => item.id === selectedItemId && item.format !== 'psd')
  const activeJob = jobs.find((job) => !job.settled)
  const estimateKey = JSON.stringify({ watched, site, model, loras, referenceItemId })

  const receiveJob = (job: CivitaiStudioJob) => {
    if (submission.current?.id === job.id) submission.current = undefined
    setJobs((current) =>
      [job, ...current.filter((entry) => entry.id !== job.id)]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20),
    )
    if (job.settled)
      window.dispatchEvent(new CustomEvent('studio-balance-changed', { detail: 'civitai' }))
    const added = job.items.filter((item) => !delivered.current.has(item.id))
    if (added.length) {
      added.forEach((item) => delivered.current.add(item.id))
      onItemsRef.current(added)
      onMobilePanel('canvas')
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
      setSite(civitai.site || 'com')
      searchSequence.current++
      setResult({ items: [] })
      setLoading(false)
      generationForm.setFieldsValue(civitai)
      setModel(civitai.model)
      setLoras(civitai.loras)
      setReferenceItemId(civitai.referenceItemId)
      setViewSource(!!civitai.referenceItemId)
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
    if (!incomingPreset) return
    const { provider, mode, values } = incomingPreset.preset
    const patch: Partial<CivitaiGenerateRequest> = {}
    const skipped: string[] = []
    if (mode === 'infill' && (values.prompt !== undefined || values.negativePrompt !== undefined)) {
      message.warning('Civitai 不支持局部重绘，已跳过该预设的局部重绘提示词')
      skipped.push('局部重绘提示词')
    } else {
      if (values.prompt !== undefined) patch.prompt = values.prompt
      if (values.negativePrompt !== undefined) patch.negativePrompt = values.negativePrompt
    }
    if (provider === 'civitai' && values.model && typeof values.model !== 'string') {
      setSite(values.site || 'com')
      setModel(values.model)
      setLoras([])
      patch.model = values.model
    } else if (values.model) skipped.push('模型')
    const validSize = (value: number | undefined) => value !== undefined && value >= 64 && value <= 2048 && value % 64 === 0
    if (validSize(values.width)) patch.width = values.width
    else if (values.width !== undefined) skipped.push('宽度')
    if (validSize(values.height)) patch.height = values.height
    else if (values.height !== undefined) skipped.push('高度')
    if (values.steps !== undefined && values.steps >= 1 && values.steps <= 150) patch.steps = values.steps
    else if (values.steps !== undefined) skipped.push('步数')
    if (values.seed !== undefined && values.seed >= -1 && values.seed <= 2147483647) patch.seed = values.seed
    else if (values.seed !== undefined) skipped.push('种子')
    if (values.sampler && CIVITAI_SAMPLERS.includes(values.sampler as CivitaiGenerateRequest['sampler'])) patch.sampler = values.sampler as CivitaiGenerateRequest['sampler']
    else if (values.sampler) skipped.push('采样器')
    if (values.schedule && CIVITAI_SCHEDULES.includes(values.schedule as CivitaiGenerateRequest['schedule'])) patch.schedule = values.schedule as CivitaiGenerateRequest['schedule']
    else if (values.schedule) skipped.push('调度')
    if (values.characters?.length) skipped.push('角色提示词')
    if (values.qualityPreset !== undefined || values.qualityToggle !== undefined) skipped.push('画质标签')
    if (values.scale !== undefined && values.scale >= 0 && values.scale <= 30) patch.scale = values.scale
    else if (values.scale !== undefined) skipped.push('CFG')
    generationForm.setFieldsValue(patch)
    setEstimate(undefined)
    const summary = `${Object.keys(patch).length ? '已套用' : '没有可套用参数'}预设「${incomingPreset.preset.name}」${skipped.length ? `；跳过 ${skipped.join('、')}` : ''}`
    if (Object.keys(patch).length) message.success(summary)
    else message.info(summary)
  }, [generationForm, incomingPreset])

  function capturePreset() {
    const current = generationForm.getFieldsValue(true) as CivitaiGenerateRequest
    const values = {
      model, site: model ? site : undefined, prompt: current.prompt, negativePrompt: current.negativePrompt,
      width: current.width, height: current.height, steps: current.steps,
      seed: current.seed, sampler: current.sampler, schedule: current.schedule, scale: current.scale,
    }
    const suggested = PRESET_FIELDS.filter((field) => {
      if (field.key === 'model') return !!model
      return touchedPresetFields.current.has(field.key) || field.keys.some((key) => {
      const actual = values[key as keyof typeof values]
      const original = INITIAL_GENERATION[key as keyof typeof INITIAL_GENERATION]
      return actual !== undefined && JSON.stringify(actual) !== JSON.stringify(original)
      })
    }).map((field) => field.key)
    return { values, suggested }
  }

  useEffect(() => {
    if (incomingReference) {
      setReferenceItemId(incomingReference.itemId)
      setViewSource(true)
    }
  }, [incomingReference])

  useEffect(() => setViewSource(false), [selectedItemId])

  async function generate(estimateOnly: boolean) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(estimateOnly ? 'estimate' : 'submit')
    try {
      if (!settings.configured) throw new Error('请先保存 Civitai API Key')
      if (!model) throw new Error('请先选择一个 Checkpoint 版本')
      if (referenceItemId && !referenceItem)
        throw new Error('参考图已不在暂存台，请重新选择或清除')
      const values = await generationForm.validateFields()
      const request: CivitaiGenerateRequest = {
        ...INITIAL_GENERATION,
        ...values,
        site,
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

  async function selectVersion(resource: CivitaiResource) {
    if (resource.type === 'Checkpoint') {
      setModel(resource)
      setLoras((current) =>
        current.filter((lora) => lora.baseModel === resource.baseModel),
      )
      setPickerOpen(false)
    } else {
      if (model && resource.baseModel !== model.baseModel)
        return void message.warning('LoRA 与主模型的基础模型必须一致')
      if (!model) {
        if (resolvingLora) return
        const sequence = searchSequence.current
        setResolvingLora(true)
        try {
          let cursor: string | undefined
          let checkpoint: CivitaiResource | undefined
          for (let page = 0; page < 3 && !checkpoint; page++) {
            const matches = await searchCivitaiModels({
              site,
              type: 'Checkpoint',
              baseModel: resource.baseModel,
              sort: 'Highest Rated',
              supportsGeneration: true,
              cursor,
              limit: 40,
            })
            if (sequence !== searchSequence.current) return
            for (const candidate of matches.items) {
              const version = candidate.versions.find(
                (item) => item.supportsGeneration && item.baseModel === resource.baseModel,
              )
              if (version) {
                checkpoint = {
                  modelId: candidate.id,
                  versionId: version.id,
                  name: `${candidate.name} · ${version.name}`,
                  baseModel: version.baseModel,
                  type: 'Checkpoint',
                }
                break
              }
            }
            cursor = matches.nextCursor
            if (!cursor) break
          }
          if (!checkpoint) {
            message.warning('未找到同基础模型的可在线生成主模型，请手动选择 Checkpoint')
            return
          }
          setModel(checkpoint)
          message.info(`已自动添加主模型：${checkpoint.name}`)
        } catch (error) {
          message.error(error instanceof Error ? error.message : '自动查找主模型失败')
          return
        } finally {
          setResolvingLora(false)
        }
      }
      setLoras((current) =>
        current.some((lora) => lora.versionId === resource.versionId)
          ? current
          : [...current, { ...resource, strength: 1 }].slice(0, 10),
      )
    }
  }

  function changeSite(next: CivitaiSite) {
    if (next === site) return
    searchSequence.current++
    setSite(next)
    setModel(undefined)
    setLoras([])
    setResult({ items: [] })
    setEstimate(undefined)
    setLoading(false)
    setPickerOpen(false)
  }

  async function search(cursor?: string, append = false) {
    if (!settings.configured) {
      message.warning('请先保存 Civitai API Key')
      return
    }
    const values = await form.validateFields()
    const sequence = ++searchSequence.current
    setLoading(true)
    try {
      const next = await searchCivitaiModels({
        ...values,
        site,
        cursor,
        limit: 20,
      })
      if (sequence !== searchSequence.current) return
      setResult((current) => ({
        items: append ? [...current.items, ...next.items] : next.items,
        nextCursor: next.nextCursor,
      }))
    } catch (error) {
      if (sequence === searchSequence.current)
        message.error(error instanceof Error ? error.message : 'Civitai 搜索失败')
    } finally {
      if (sequence === searchSequence.current) setLoading(false)
    }
  }

  return (
    <div className={`studio-civitai-workbench is-mobile-${mobilePanel}`}>
      <aside className="studio-civitai-parameters">
        <header className="studio-novelai-parameters-header">
          <strong>Civitai 生成参数</strong>
          <span>GENERATION</span>
        </header>
        <div className="studio-novelai-parameters-scroll">
          <Collapse size="small" items={[{
            key: 'key',
            label: `Civitai 连接 · ${settings.configured ? '已设置' : '未设置'}`,
            children: <ProviderKeyCard
              provider="Civitai"
              configured={settings.configured}
              keyHint={settings.keyHint}
              onSave={async (apiKey) => onSettings(await updateCivitaiSettings({ apiKey }))}
              onClear={async () => onSettings(await updateCivitaiSettings({ clearApiKey: true }))}
              onTest={async () => {
                const result = await testStudioProvider('civitai')
                return result.username
              }}
            />,
          }]} />
          <div className="studio-civitai-site-picker">
            <strong>模型站点</strong>
            <Segmented
              block
              aria-label="Civitai 模型站点"
              value={site}
              options={[
                { label: 'com 主站', value: 'com' },
                { label: 'red 站', value: 'red' },
              ]}
              disabled={!!busy || !!submission.current}
              onChange={(value) => changeSite(value as CivitaiSite)}
            />
          </div>
          <div className="studio-civitai-selected-model">
            <strong>主模型</strong>
            <span>{model?.name || '尚未选择 Checkpoint'}</span>
            {model && <Tag>{model.baseModel}</Tag>}
            <Button icon={<SearchOutlined />} onClick={() => setPickerOpen(true)}>
              选择模型 / 添加 LoRA
            </Button>
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
            onValuesChange={(changed: Partial<CivitaiGenerateRequest>) => {
              for (const field of PRESET_FIELDS) if (field.keys.some((key) => changed[key as keyof CivitaiGenerateRequest] !== undefined)) touchedPresetFields.current.add(field.key)
            }}
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
              setViewSource(true)
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
              onChange={(id) => {
                setReferenceItemId(id)
                setViewSource(!!id)
              }}
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
            <PresetSaveButton provider="civitai" mode={referenceItemId ? 'img2img' : 'generate'} capture={capturePreset} onSave={onSavePreset} />
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
      <div className="studio-novelai-stage">
        <NovelAICanvas
          imageUrl={viewSource && referenceItem ? studioFileUrl(referenceItem.id) : selectedItem ? studioFileUrl(selectedItem.id) : referenceItem ? studioFileUrl(referenceItem.id) : undefined}
          name={viewSource && referenceItem ? referenceItem.name : selectedItem?.name || referenceItem?.name}
          generating={!!activeJob && polling}
          actions={<>
            {referenceItem && selectedItem && referenceItem.id !== selectedItem.id &&
              <Button size="small" onClick={() => setViewSource((current) => !current)}>
                {viewSource ? '查看结果' : '查看参考图'}
              </Button>}
            {selectedItem && <Button size="small" onClick={() => {
              setReferenceItemId(selectedItem.id)
              setViewSource(true)
              onMobilePanel('parameters')
            }}>用作图生图</Button>}
          </>}
          emptyActions={<Button onClick={() => onMobilePanel('parameters')}>设置生成参数</Button>}
        />
      </div>
      <Modal
        title="选择 Civitai 模型"
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        footer={null}
        width={1080}
        style={{
          '--studio-panel': token.colorBgContainer,
          '--studio-border': token.colorBorder,
          '--studio-muted': token.colorTextSecondary,
        } as React.CSSProperties}
        styles={{ body: { maxHeight: 'min(72vh, 850px)', overflowY: 'auto' } }}
      >
      <div className="studio-provider-panel studio-civitai-catalog">
        <Alert
          showIcon
          type="info"
          title="选择模型版本后生成"
          description="支持 SD 1.x、SDXL、Pony、Illustrious / NoobAI 的 Checkpoint 与同基础模型 LoRA。生成消耗 Civitai Buzz，可先预估；结果自动进入暂存台。"
        />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ sort: 'Highest Rated', favorites: false, supportsGeneration: true }}
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
            <Form.Item name="supportsGeneration" valuePropName="checked" noStyle>
              <Switch checkedChildren="可在线生成" unCheckedChildren="全部模型" />
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
          <Empty description="搜索 Checkpoint 或 LoRA；切换站点需重新选择模型" />
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
                    href={`${civitaiSiteBaseUrl(site)}/models/${model.id}`}
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
                            resolvingLora ||
                            !version.supportsGeneration ||
                            !civitaiEcosystem(version.baseModel)
                          }
                          onClick={() => void selectVersion({
                              modelId: model.id,
                              versionId: version.id,
                              name: `${model.name} · ${version.name}`,
                              baseModel: version.baseModel,
                              type: model.type as CivitaiResource['type'],
                            })}
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
      </Modal>
    </div>
  )
}
