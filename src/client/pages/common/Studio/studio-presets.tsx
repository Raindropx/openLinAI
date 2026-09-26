import { CopyOutlined, DeleteOutlined, DownOutlined, EditOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Empty, Input, InputNumber, Modal, Select, Tag, Tooltip, message } from 'antd'
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { CivitaiResource } from '../../../../shared/civitai-generation'
import type { NovelAICharacterPrompt } from '../../../../shared/studio-generation'
import { NOVELAI_IMAGE_MODELS } from '../../../../shared/studio-generation'

export type PresetProvider = 'novelai' | 'civitai'
export type PresetMode = 'generate' | 'img2img' | 'infill'
export type PresetField = 'model' | 'prompt' | 'negativePrompt' | 'characters' | 'size' | 'steps' | 'seed' | 'sampler' | 'scale' | 'quality'
export interface PresetValues {
  model?: string | CivitaiResource
  site?: 'com' | 'red'
  prompt?: string
  negativePrompt?: string
  characters?: NovelAICharacterPrompt[]
  width?: number
  height?: number
  steps?: number
  seed?: number
  sampler?: string
  schedule?: string
  scale?: number
  cfgRescale?: number
  qualityPreset?: string
  qualityToggle?: boolean
}
export interface StudioPreset {
  id: string
  name: string
  category: string
  provider: PresetProvider
  mode: PresetMode
  values: PresetValues
  createdAt: number
}

export const PRESET_FIELDS: { key: PresetField; label: string; keys: (keyof PresetValues)[] }[] = [
  { key: 'model', label: '模型名', keys: ['model', 'site'] },
  { key: 'prompt', label: '提示词', keys: ['prompt'] },
  { key: 'negativePrompt', label: '负面提示词 / UC', keys: ['negativePrompt'] },
  { key: 'characters', label: '角色提示词、角色 UC、位置', keys: ['characters'] },
  { key: 'size', label: '宽度和高度', keys: ['width', 'height'] },
  { key: 'steps', label: '步数', keys: ['steps'] },
  { key: 'seed', label: '种子', keys: ['seed'] },
  { key: 'sampler', label: '采样器和调度', keys: ['sampler', 'schedule'] },
  { key: 'scale', label: 'CFG', keys: ['scale', 'cfgRescale'] },
  { key: 'quality', label: '画质标签', keys: ['qualityPreset', 'qualityToggle'] },
]
export const presetModeLabel = (mode: PresetMode) => ({ generate: '文生图', img2img: '图生图', infill: '局部重绘' })[mode]
export const presetProviderLabel = (provider: PresetProvider) => provider === 'novelai' ? 'NovelAI' : 'Civitai'

export function readStudioPresets(): StudioPreset[] {
  try {
    const data: unknown = JSON.parse(window.localStorage.getItem('studio-presets-v1') || '[]')
    if (!Array.isArray(data)) return []
    return data.filter((item): item is StudioPreset => Boolean(item && typeof item === 'object' &&
      typeof item.id === 'string' && typeof item.name === 'string' &&
      (item.provider === 'novelai' || item.provider === 'civitai') &&
      ['generate', 'img2img', 'infill'].includes(item.mode) &&
      item.values && typeof item.values === 'object'))
  } catch { return [] }
}

export function PresetSaveButton({ provider, mode, capture, onSave }: {
  provider: PresetProvider
  mode: PresetMode
  capture: () => { values: PresetValues; suggested: PresetField[] }
  onSave: (preset: StudioPreset) => boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<PresetField[]>([])
  const [snapshot, setSnapshot] = useState<PresetValues>({})
  const [saveError, setSaveError] = useState('')
  const begin = () => {
    setName('')
    setSaveError('')
    setOpen(true)
    try {
      const { values, suggested } = capture()
      setSnapshot(values)
      setSelected(suggested)
    } catch (error) {
      setSnapshot({})
      setSelected([])
      setSaveError(error instanceof Error ? `读取当前参数失败：${error.message}` : '读取当前参数失败')
    }
  }
  const save = () => {
    if (!name.trim()) { setSaveError('请输入预设名'); return }
    if (!selected.length) { setSaveError('至少选择一项参数'); return }
    const values: PresetValues = {}
    for (const field of PRESET_FIELDS.filter((entry) => selected.includes(entry.key)))
      for (const key of field.keys) if (snapshot[key] !== undefined) Object.assign(values, { [key]: snapshot[key] })
    try {
      if (onSave({ id: uuidv4(), name: name.trim(), category: '', provider, mode, values: JSON.parse(JSON.stringify(values)) as PresetValues, createdAt: Date.now() })) setOpen(false)
      else setSaveError('保存失败：浏览器本地存储不可用或空间不足')
    } catch (error) {
      setSaveError(error instanceof Error ? `保存失败：${error.message}` : '预设保存失败')
    }
  }
  return <>
    <Button icon={<PlusOutlined />} block onClick={begin}>添加到预设</Button>
    <Modal title="保存工作室预设" open={open} onCancel={() => setOpen(false)} onOk={save} okText="保存预设" destroyOnHidden>
      <Input autoFocus maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setSaveError('') }} placeholder="预设名" onPressEnter={save} />
      {saveError && <Alert className="studio-preset-save-error" type="error" showIcon title={saveError} />}
      <p className="studio-preset-hint">已自动勾选改动过的参数；可按需增减。预设只保存勾选的文字和参数，不保存参考图或遮罩。</p>
      <div className="studio-preset-checks">{PRESET_FIELDS.map((field) => {
        const available = field.keys.some((key) => snapshot[key] !== undefined)
        return <Checkbox key={field.key} disabled={!available} checked={selected.includes(field.key)} onChange={(event) =>
          { setSaveError(''); setSelected((current) => event.target.checked ? [...current, field.key] : current.filter((key) => key !== field.key)) }
        }>{field.label}</Checkbox>
      })}</div>
    </Modal>
  </>
}

function preview(values: PresetValues) {
  const model = values.model
  return [
    typeof model === 'string' ? model : model?.name,
    values.prompt && `提示词：${values.prompt}`,
    values.negativePrompt && `UC：${values.negativePrompt}`,
    values.characters?.length && `角色 ${values.characters.length}`,
    values.width && values.height && `${values.width}×${values.height}`,
    values.steps !== undefined && `${values.steps} 步`,
    values.seed !== undefined && `种子 ${values.seed}`,
    values.sampler,
    values.scale !== undefined && `CFG ${values.scale}`,
    values.qualityPreset || (values.qualityToggle ? '自动质量标签' : undefined),
  ].filter(Boolean).map(String)
}

export function StudioPresetShelf({ presets, currentProvider, onChange, onApply }: {
  presets: StudioPreset[]
  currentProvider: PresetProvider
  onChange: (presets: StudioPreset[]) => void
  onApply: (preset: StudioPreset) => void
}) {
  const [category, setCategory] = useState('全部')
  const [editing, setEditing] = useState<StudioPreset | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftCategory, setDraftCategory] = useState('')
  const [draftValues, setDraftValues] = useState<PresetValues>({})
  const categories = ['全部', ...new Set(presets.map((preset) => preset.category).filter(Boolean))]
  const selectedCategory = categories.includes(category) ? category : '全部'
  const visible = selectedCategory === '全部' ? presets : presets.filter((preset) => preset.category === selectedCategory)
  const edit = (preset: StudioPreset) => { setEditing(preset); setDraftName(preset.name); setDraftCategory(preset.category); setDraftValues({ ...preset.values }) }
  const setField = <K extends keyof PresetValues>(key: K, value: PresetValues[K]) => setDraftValues((current) => ({ ...current, [key]: value }))
  const toggleField = (field: (typeof PRESET_FIELDS)[number], checked: boolean) => setDraftValues((current) => {
    const next = { ...current }
    if (checked) for (const key of field.keys) {
      if (next[key] === undefined && editing?.values[key] !== undefined) Object.assign(next, { [key]: editing.values[key] })
    }
    else for (const key of field.keys) delete next[key]
    return next
  })
  const remove = (id: string) => Modal.confirm({ title: '删除这个预设？', onOk: () => onChange(presets.filter((preset) => preset.id !== id)) })
  const move = (id: string, direction: -1 | 1) => {
    const order = [...presets]
    const index = order.findIndex((preset) => preset.id === id)
    const neighbor = visible[visible.findIndex((preset) => preset.id === id) + direction]
    if (!neighbor) return
    const otherIndex = order.findIndex((preset) => preset.id === neighbor.id)
    ;[order[index], order[otherIndex]] = [order[otherIndex], order[index]]
    onChange(order)
  }
  return <>
    <div className="studio-preset-tools"><Select aria-label="预设分类" value={selectedCategory} options={categories.map((entry) => ({ label: entry, value: entry }))} onChange={setCategory} /></div>
    <div className="studio-shelf-list studio-preset-list">{visible.length ? visible.map((preset) => <article className="studio-preset-card" key={preset.id}>
      <div className="studio-preset-card-title"><strong title={preset.name}>{preset.name}</strong><Button size="small" type="primary" onClick={() => onApply(preset)}>套用</Button></div>
      <div className="studio-preset-tags"><Tag>{presetProviderLabel(preset.provider)}</Tag><Tag>{presetModeLabel(preset.mode)}</Tag>{preset.category && <Tag>{preset.category}</Tag>}</div>
      <div className="studio-preset-preview" title={preview(preset.values).join(' · ')}>{preview(preset.values).join(' · ') || '空预设'}</div>
      <div className="studio-preset-actions">
        <Tooltip title="编辑名称和分类"><Button size="small" type="text" icon={<EditOutlined />} onClick={() => edit(preset)} /></Tooltip>
        <Tooltip title="拷贝预设"><Button size="small" type="text" icon={<CopyOutlined />} onClick={() => onChange([...presets, { ...preset, id: uuidv4(), name: `${preset.name} 副本`, createdAt: Date.now() }])} /></Tooltip>
        <Tooltip title="上移"><Button size="small" type="text" icon={<UpOutlined />} disabled={visible[0]?.id === preset.id} onClick={() => move(preset.id, -1)} /></Tooltip>
        <Tooltip title="下移"><Button size="small" type="text" icon={<DownOutlined />} disabled={visible[visible.length - 1]?.id === preset.id} onClick={() => move(preset.id, 1)} /></Tooltip>
        <Tooltip title="删除"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(preset.id)} /></Tooltip>
      </div>
    </article>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这里还没有预设" />}</div>
    <Modal title="编辑预设" open={!!editing} onCancel={() => setEditing(null)} onOk={() => {
      if (!draftName.trim() || !editing) { message.warning('请输入预设名'); return }
      if (!Object.keys(draftValues).length) { message.warning('至少保留一项参数'); return }
      onChange(presets.map((preset) => preset.id === editing.id ? { ...preset, name: draftName.trim(), category: draftCategory.trim(), values: draftValues } : preset))
      setEditing(null)
    }} okText="保存">
      <Input value={draftName} maxLength={80} onChange={(event) => setDraftName(event.target.value)} placeholder="预设名" />
      <Input className="studio-preset-category-input" value={draftCategory} maxLength={40} onChange={(event) => setDraftCategory(event.target.value)} placeholder="分类（可留空）" />
      <div className="studio-preset-editor">{PRESET_FIELDS.map((field) => <div className="studio-preset-editor-row" key={field.key}>
        <Checkbox disabled={!field.keys.some((key) => editing?.values[key] !== undefined)} checked={field.keys.some((key) => draftValues[key] !== undefined)} onChange={(event) => toggleField(field, event.target.checked)}>{field.label}</Checkbox>
        {field.key === 'model' && typeof draftValues.model === 'string' && <Select value={draftValues.model} options={NOVELAI_IMAGE_MODELS.map((model) => ({ label: model.name, value: model.id }))} onChange={(value) => setField('model', value)} />}
        {field.key === 'model' && draftValues.model && typeof draftValues.model !== 'string' && <Input value={draftValues.model.name} readOnly title="Civitai 模型版本需在生成页选择后保存新预设" />}
        {field.key === 'prompt' && draftValues.prompt !== undefined && <Input.TextArea rows={3} value={draftValues.prompt} onChange={(event) => setField('prompt', event.target.value)} />}
        {field.key === 'negativePrompt' && draftValues.negativePrompt !== undefined && <Input.TextArea rows={2} value={draftValues.negativePrompt} onChange={(event) => setField('negativePrompt', event.target.value)} />}
        {field.key === 'characters' && draftValues.characters?.map((character, index) => <div className="studio-preset-character" key={index}>
          <strong>角色 {index + 1}</strong>
          <Input.TextArea rows={2} value={character.prompt} placeholder="角色提示词" onChange={(event) => setField('characters', draftValues.characters?.map((entry, at) => at === index ? { ...entry, prompt: event.target.value } : entry))} />
          <Input.TextArea rows={2} value={character.negativePrompt} placeholder="角色 UC" onChange={(event) => setField('characters', draftValues.characters?.map((entry, at) => at === index ? { ...entry, negativePrompt: event.target.value } : entry))} />
          <div className="studio-preset-editor-pair"><InputNumber min={0} max={1} step={0.05} value={character.position?.x} placeholder="横向位置" onChange={(value) => setField('characters', draftValues.characters?.map((entry, at) => at === index ? { ...entry, position: { x: value ?? 0, y: entry.position?.y ?? 0.5 } } : entry))} /><InputNumber min={0} max={1} step={0.05} value={character.position?.y} placeholder="纵向位置" onChange={(value) => setField('characters', draftValues.characters?.map((entry, at) => at === index ? { ...entry, position: { x: entry.position?.x ?? 0.5, y: value ?? 0 } } : entry))} /></div>
        </div>)}
        {field.key === 'size' && draftValues.width !== undefined && <div className="studio-preset-editor-pair"><InputNumber min={64} max={2048} step={64} value={draftValues.width} onChange={(value) => setField('width', value ?? undefined)} /><InputNumber min={64} max={2048} step={64} value={draftValues.height} onChange={(value) => setField('height', value ?? undefined)} /></div>}
        {field.key === 'steps' && draftValues.steps !== undefined && <InputNumber min={1} max={150} value={draftValues.steps} onChange={(value) => setField('steps', value ?? undefined)} />}
        {field.key === 'seed' && draftValues.seed !== undefined && <InputNumber min={-1} max={2147483647} value={draftValues.seed} onChange={(value) => setField('seed', value ?? undefined)} />}
        {field.key === 'sampler' && draftValues.sampler !== undefined && <div className="studio-preset-editor-pair"><Input value={draftValues.sampler} onChange={(event) => setField('sampler', event.target.value)} placeholder="采样器" /><Input value={draftValues.schedule} onChange={(event) => setField('schedule', event.target.value)} placeholder="调度" /></div>}
        {field.key === 'scale' && draftValues.scale !== undefined && <div className="studio-preset-editor-pair"><InputNumber min={0} max={30} step={0.1} value={draftValues.scale} onChange={(value) => setField('scale', value ?? undefined)} /><InputNumber min={0} max={1} step={0.05} value={draftValues.cfgRescale} onChange={(value) => setField('cfgRescale', value ?? undefined)} placeholder="Rescale" /></div>}
        {field.key === 'quality' && draftValues.qualityPreset !== undefined && <Select value={draftValues.qualityPreset} options={['none', 'light', 'standard'].map((value) => ({ label: value, value }))} onChange={(value) => setField('qualityPreset', value)} />}
        {field.key === 'quality' && draftValues.qualityToggle !== undefined && <Checkbox checked={draftValues.qualityToggle} onChange={(event) => setField('qualityToggle', event.target.checked)}>自动质量标签</Checkbox>}
      </div>)}</div>
      <p className="studio-preset-hint">套用到 {presetProviderLabel(currentProvider)} 时会自动跳过不兼容的字段。</p>
    </Modal>
  </>
}
