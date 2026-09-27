import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PlusOutlined,
  UpOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Tag,
  Tooltip,
  message,
} from 'antd'
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { CivitaiResource } from '../../../../shared/civitai-generation'
import type { NovelAICharacterPrompt } from '../../../../shared/studio-generation'
import { NOVELAI_IMAGE_MODELS } from '../../../../shared/studio-generation'
import { t, useAppLanguage } from '../../../i18n'

export type PresetProvider = 'novelai' | 'civitai'
export type PresetMode = 'generate' | 'img2img' | 'infill'
export type PresetField =
  | 'model'
  | 'prompt'
  | 'negativePrompt'
  | 'characters'
  | 'size'
  | 'steps'
  | 'seed'
  | 'sampler'
  | 'scale'
  | 'quality'
export interface PresetValues {
  model?: string | CivitaiResource
  site?: 'com' | 'red'
  prompt?: string
  promptMode?: 'anime' | 'furry'
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

export const PRESET_FIELDS: {
  key: PresetField
  label: string
  keys: (keyof PresetValues)[]
}[] = [
  {
    key: 'model',
    get label() {
      return t('模型名')
    },
    keys: ['model', 'site'],
  },
  {
    key: 'prompt',
    get label() {
      return t('提示词')
    },
    keys: ['prompt', 'promptMode'],
  },
  {
    key: 'negativePrompt',
    get label() {
      return t('负面提示词 / UC')
    },
    keys: ['negativePrompt'],
  },
  {
    key: 'characters',
    get label() {
      return t('角色提示词、角色 UC、位置')
    },
    keys: ['characters'],
  },
  {
    key: 'size',
    get label() {
      return t('宽度和高度')
    },
    keys: ['width', 'height'],
  },
  {
    key: 'steps',
    get label() {
      return t('步数')
    },
    keys: ['steps'],
  },
  {
    key: 'seed',
    get label() {
      return t('种子')
    },
    keys: ['seed'],
  },
  {
    key: 'sampler',
    get label() {
      return t('采样器和调度')
    },
    keys: ['sampler', 'schedule'],
  },
  { key: 'scale', label: 'CFG', keys: ['scale', 'cfgRescale'] },
  {
    key: 'quality',
    get label() {
      return t('画质标签')
    },
    keys: ['qualityPreset', 'qualityToggle'],
  },
]
export const presetModeLabel = (mode: PresetMode) =>
  ({ generate: t('文生图'), img2img: t('图生图'), infill: t('局部重绘') })[mode]
export const presetProviderLabel = (provider: PresetProvider) =>
  provider === 'novelai' ? 'NovelAI' : 'Civitai'

export function readStudioPresets(): StudioPreset[] {
  try {
    const data: unknown = JSON.parse(
      window.localStorage.getItem('studio-presets-v1') || '[]',
    )
    if (!Array.isArray(data)) return []
    return data.filter((item): item is StudioPreset =>
      Boolean(
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        (item.provider === 'novelai' || item.provider === 'civitai') &&
        ['generate', 'img2img', 'infill'].includes(item.mode) &&
        item.values &&
        typeof item.values === 'object',
      ),
    )
  } catch {
    return []
  }
}

export function PresetSaveButton({
  provider,
  mode,
  capture,
  onSave,
}: {
  provider: PresetProvider
  mode: PresetMode
  capture: () => { values: PresetValues; suggested: PresetField[] }
  onSave: (preset: StudioPreset) => boolean
}) {
  useAppLanguage()

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
      setSaveError(
        error instanceof Error
          ? t('读取当前参数失败：{0}', [t(error.message)])
          : t('读取当前参数失败'),
      )
    }
  }
  const save = () => {
    if (!name.trim()) {
      setSaveError(t('请输入预设名'))
      return
    }
    if (!selected.length) {
      setSaveError(t('至少选择一项参数'))
      return
    }
    const values: PresetValues = {}
    for (const field of PRESET_FIELDS.filter((entry) =>
      selected.includes(entry.key),
    ))
      for (const key of field.keys)
        if (snapshot[key] !== undefined)
          Object.assign(values, { [key]: snapshot[key] })
    try {
      if (
        onSave({
          id: uuidv4(),
          name: name.trim(),
          category: '',
          provider,
          mode,
          values: JSON.parse(JSON.stringify(values)) as PresetValues,
          createdAt: Date.now(),
        })
      )
        setOpen(false)
      else setSaveError(t('保存失败：浏览器本地存储不可用或空间不足'))
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? t('保存失败：{0}', [t(error.message)])
          : t('预设保存失败'),
      )
    }
  }
  return (
    <>
      <Button icon={<PlusOutlined />} block onClick={begin}>
        {t('添加到预设')}
      </Button>
      <Modal
        title={t('保存工作室预设')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText={t('保存预设')}
        destroyOnHidden
      >
        <Input
          autoFocus
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setSaveError('')
          }}
          placeholder={t('预设名')}
          onPressEnter={save}
        />
        {saveError && (
          <Alert
            className="studio-preset-save-error"
            type="error"
            showIcon
            title={saveError}
          />
        )}
        <p className="studio-preset-hint">
          {t(
            '已自动勾选改动过的参数；可按需增减。预设只保存勾选的文字和参数，不保存参考图或遮罩。',
          )}
        </p>
        <div className="studio-preset-checks">
          {PRESET_FIELDS.map((field) => {
            const available = field.keys.some(
              (key) => snapshot[key] !== undefined,
            )
            return (
              <Checkbox
                key={field.key}
                disabled={!available}
                checked={selected.includes(field.key)}
                onChange={(event) => {
                  setSaveError('')
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, field.key]
                      : current.filter((key) => key !== field.key),
                  )
                }}
              >
                {field.label}
              </Checkbox>
            )
          })}
        </div>
      </Modal>
    </>
  )
}

function preview(values: PresetValues) {
  const model = values.model
  return [
    typeof model === 'string' ? model : model?.name,
    values.prompt && t('提示词：{0}', [values.prompt]),
    values.negativePrompt && `UC：${values.negativePrompt}`,
    values.characters?.length && t('角色 {0}', [values.characters.length]),
    values.width && values.height && `${values.width}×${values.height}`,
    values.steps !== undefined && t('{0} 步', [values.steps]),
    values.seed !== undefined && t('种子 {0}', [values.seed]),
    values.sampler,
    values.scale !== undefined && `CFG ${values.scale}`,
    values.qualityPreset ||
      (values.qualityToggle ? t('自动质量标签') : undefined),
  ]
    .filter(Boolean)
    .map(String)
}

export function StudioPresetShelf({
  presets,
  currentProvider,
  onChange,
  onApply,
}: {
  presets: StudioPreset[]
  currentProvider: PresetProvider
  onChange: (presets: StudioPreset[]) => void
  onApply: (preset: StudioPreset) => void
}) {
  useAppLanguage()

  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<StudioPreset | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftCategory, setDraftCategory] = useState('')
  const [draftValues, setDraftValues] = useState<PresetValues>({})
  const [draftFields, setDraftFields] = useState<PresetField[]>([])
  const categories = [
    '',
    ...new Set(presets.map((preset) => preset.category).filter(Boolean)),
  ]
  const selectedCategory = categories.includes(category) ? category : ''
  const visible =
    selectedCategory === ''
      ? presets
      : presets.filter((preset) => preset.category === selectedCategory)
  const edit = (preset: StudioPreset) => {
    setEditing(preset)
    setDraftName(preset.name)
    setDraftCategory(preset.category)
    setDraftValues({ ...preset.values })
    setDraftFields(
      PRESET_FIELDS.filter((field) =>
        field.keys.some((key) => preset.values[key] !== undefined),
      ).map((field) => field.key),
    )
  }
  const setField = <K extends keyof PresetValues>(
    key: K,
    value: PresetValues[K],
  ) => setDraftValues((current) => ({ ...current, [key]: value }))
  const toggleField = (
    field: (typeof PRESET_FIELDS)[number],
    checked: boolean,
  ) => {
    setDraftFields((current) =>
      checked
        ? [...current, field.key]
        : current.filter((key) => key !== field.key),
    )
    setDraftValues((current) => {
      const next = { ...current }
      if (checked)
        for (const key of field.keys) {
          if (next[key] === undefined && editing?.values[key] !== undefined)
            Object.assign(next, { [key]: editing.values[key] })
        }
      else for (const key of field.keys) delete next[key]
      return next
    })
  }
  const remove = (id: string) =>
    Modal.confirm({
      title: t('删除这个预设？'),
      onOk: () => onChange(presets.filter((preset) => preset.id !== id)),
    })
  const move = (id: string, direction: -1 | 1) => {
    const order = [...presets]
    const index = order.findIndex((preset) => preset.id === id)
    const neighbor =
      visible[visible.findIndex((preset) => preset.id === id) + direction]
    if (!neighbor) return
    const otherIndex = order.findIndex((preset) => preset.id === neighbor.id)
    ;[order[index], order[otherIndex]] = [order[otherIndex], order[index]]
    onChange(order)
  }
  return (
    <>
      <div className="studio-preset-tools">
        <Select
          aria-label={t('预设分类')}
          value={selectedCategory}
          options={categories.map((entry) => ({
            label: entry || t('全部'),
            value: entry,
          }))}
          onChange={setCategory}
        />
      </div>
      <div className="studio-shelf-list studio-preset-list">
        {visible.length ? (
          visible.map((preset) => (
            <article className="studio-preset-card" key={preset.id}>
              <div className="studio-preset-card-title">
                <strong title={preset.name}>{preset.name}</strong>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => onApply(preset)}
                >
                  {t('套用')}
                </Button>
              </div>
              <div className="studio-preset-tags">
                <Tag>{presetProviderLabel(preset.provider)}</Tag>
                <Tag>{presetModeLabel(preset.mode)}</Tag>
                {preset.category && <Tag>{preset.category}</Tag>}
              </div>
              <div
                className="studio-preset-preview"
                title={preview(preset.values).join(' · ')}
              >
                {preview(preset.values).join(' · ') || t('空预设')}
              </div>
              <div className="studio-preset-actions">
                <Tooltip title={t('编辑名称和分类')}>
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => edit(preset)}
                  />
                </Tooltip>
                <Tooltip title={t('拷贝预设')}>
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() =>
                      onChange([
                        ...presets,
                        {
                          ...preset,
                          id: uuidv4(),
                          name: t('{0} 副本', [preset.name]),
                          createdAt: Date.now(),
                        },
                      ])
                    }
                  />
                </Tooltip>
                <Tooltip title={t('上移')}>
                  <Button
                    size="small"
                    type="text"
                    icon={<UpOutlined />}
                    disabled={visible[0]?.id === preset.id}
                    onClick={() => move(preset.id, -1)}
                  />
                </Tooltip>
                <Tooltip title={t('下移')}>
                  <Button
                    size="small"
                    type="text"
                    icon={<DownOutlined />}
                    disabled={visible[visible.length - 1]?.id === preset.id}
                    onClick={() => move(preset.id, 1)}
                  />
                </Tooltip>
                <Tooltip title={t('删除')}>
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => remove(preset.id)}
                  />
                </Tooltip>
              </div>
            </article>
          ))
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('这里还没有预设')}
          />
        )}
      </div>
      <Modal
        title={t('编辑预设')}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => {
          if (!draftName.trim() || !editing) {
            message.warning(t('请输入预设名'))
            return
          }
          if (
            draftFields.includes('size') &&
            ![draftValues.width, draftValues.height].every(
              (value) =>
                value !== undefined &&
                Number.isInteger(value) &&
                value >= 64 &&
                value <= 2048 &&
                value % 64 === 0,
            )
          ) {
            message.warning(
              t('请填写完整的宽度和高度，尺寸须为 64–2048 之间的 64 倍数'),
            )
            return
          }
          if (
            !Object.values(draftValues).some((value) => value !== undefined)
          ) {
            message.warning(t('至少保留一项参数'))
            return
          }
          onChange(
            presets.map((preset) =>
              preset.id === editing.id
                ? {
                    ...preset,
                    name: draftName.trim(),
                    category: draftCategory.trim(),
                    values: draftValues,
                  }
                : preset,
            ),
          )
          setEditing(null)
        }}
        okText={t('保存')}
      >
        <Input
          value={draftName}
          maxLength={80}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder={t('预设名')}
        />
        <Input
          className="studio-preset-category-input"
          value={draftCategory}
          maxLength={40}
          onChange={(event) => setDraftCategory(event.target.value)}
          placeholder={t('分类（可留空）')}
        />
        <div className="studio-preset-editor">
          {PRESET_FIELDS.map((field) => (
            <div className="studio-preset-editor-row" key={field.key}>
              <Checkbox
                disabled={
                  !field.keys.some((key) => editing?.values[key] !== undefined)
                }
                checked={draftFields.includes(field.key)}
                onChange={(event) => toggleField(field, event.target.checked)}
              >
                {field.label}
              </Checkbox>
              {draftFields.includes(field.key) && (
                <>
                  {field.key === 'model' &&
                    typeof draftValues.model === 'string' && (
                      <Select
                        value={draftValues.model}
                        options={NOVELAI_IMAGE_MODELS.map((model) => ({
                          label: model.name,
                          value: model.id,
                        }))}
                        onChange={(value) => setField('model', value)}
                      />
                    )}
                  {field.key === 'model' &&
                    draftValues.model &&
                    typeof draftValues.model !== 'string' && (
                      <Input
                        value={draftValues.model.name}
                        readOnly
                        title={t('Civitai 模型版本需在生成页选择后保存新预设')}
                      />
                    )}
                  {field.key === 'prompt' &&
                    draftValues.prompt !== undefined && (
                      <Input.TextArea
                        rows={3}
                        value={draftValues.prompt}
                        onChange={(event) =>
                          setField('prompt', event.target.value)
                        }
                      />
                    )}
                  {field.key === 'prompt' &&
                    editing?.provider === 'novelai' && (
                      <Select
                        aria-label={t('提示词模式')}
                        placeholder={t('提示词模式（旧预设按标签识别）')}
                        value={draftValues.promptMode}
                        options={[
                          { label: 'Anime', value: 'anime' },
                          { label: 'Furry', value: 'furry' },
                        ]}
                        onChange={(value) => setField('promptMode', value)}
                      />
                    )}
                  {field.key === 'negativePrompt' &&
                    draftValues.negativePrompt !== undefined && (
                      <Input.TextArea
                        rows={2}
                        value={draftValues.negativePrompt}
                        onChange={(event) =>
                          setField('negativePrompt', event.target.value)
                        }
                      />
                    )}
                  {field.key === 'characters' &&
                    draftValues.characters?.map((character, index) => (
                      <div className="studio-preset-character" key={index}>
                        <strong>
                          {t('角色')} {index + 1}
                        </strong>
                        <Input.TextArea
                          rows={2}
                          value={character.prompt}
                          placeholder={t('角色提示词')}
                          onChange={(event) =>
                            setField(
                              'characters',
                              draftValues.characters?.map((entry, at) =>
                                at === index
                                  ? { ...entry, prompt: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <Input.TextArea
                          rows={2}
                          value={character.negativePrompt}
                          placeholder={t('角色 UC')}
                          onChange={(event) =>
                            setField(
                              'characters',
                              draftValues.characters?.map((entry, at) =>
                                at === index
                                  ? {
                                      ...entry,
                                      negativePrompt: event.target.value,
                                    }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <div className="studio-preset-editor-pair">
                          <InputNumber
                            min={0}
                            max={1}
                            step={0.05}
                            value={character.position?.x}
                            placeholder={t('横向位置')}
                            onChange={(value) =>
                              setField(
                                'characters',
                                draftValues.characters?.map((entry, at) =>
                                  at === index
                                    ? {
                                        ...entry,
                                        position: {
                                          x: value ?? 0,
                                          y: entry.position?.y ?? 0.5,
                                        },
                                      }
                                    : entry,
                                ),
                              )
                            }
                          />
                          <InputNumber
                            min={0}
                            max={1}
                            step={0.05}
                            value={character.position?.y}
                            placeholder={t('纵向位置')}
                            onChange={(value) =>
                              setField(
                                'characters',
                                draftValues.characters?.map((entry, at) =>
                                  at === index
                                    ? {
                                        ...entry,
                                        position: {
                                          x: entry.position?.x ?? 0.5,
                                          y: value ?? 0,
                                        },
                                      }
                                    : entry,
                                ),
                              )
                            }
                          />
                        </div>
                      </div>
                    ))}
                  {field.key === 'size' && (
                    <div className="studio-preset-editor-pair">
                      <InputNumber
                        min={64}
                        max={2048}
                        step={64}
                        value={draftValues.width ?? null}
                        onChange={(value) =>
                          setField('width', value ?? undefined)
                        }
                      />
                      <InputNumber
                        min={64}
                        max={2048}
                        step={64}
                        value={draftValues.height ?? null}
                        onChange={(value) =>
                          setField('height', value ?? undefined)
                        }
                      />
                    </div>
                  )}
                  {field.key === 'steps' && (
                    <InputNumber
                      min={1}
                      max={150}
                      value={draftValues.steps ?? null}
                      onChange={(value) =>
                        setField('steps', value ?? undefined)
                      }
                    />
                  )}
                  {field.key === 'seed' && (
                    <InputNumber
                      min={-1}
                      max={2147483647}
                      value={draftValues.seed ?? null}
                      onChange={(value) => setField('seed', value ?? undefined)}
                    />
                  )}
                  {field.key === 'sampler' && (
                    <div className="studio-preset-editor-pair">
                      <Input
                        value={draftValues.sampler ?? ''}
                        onChange={(event) =>
                          setField('sampler', event.target.value)
                        }
                        placeholder={t('采样器')}
                      />
                      <Input
                        value={draftValues.schedule ?? ''}
                        onChange={(event) =>
                          setField('schedule', event.target.value)
                        }
                        placeholder={t('调度')}
                      />
                    </div>
                  )}
                  {field.key === 'scale' && (
                    <div className="studio-preset-editor-pair">
                      <InputNumber
                        min={0}
                        max={30}
                        step={0.1}
                        value={draftValues.scale ?? null}
                        onChange={(value) =>
                          setField('scale', value ?? undefined)
                        }
                      />
                      <InputNumber
                        min={0}
                        max={1}
                        step={0.05}
                        value={draftValues.cfgRescale ?? null}
                        onChange={(value) =>
                          setField('cfgRescale', value ?? undefined)
                        }
                        placeholder="Rescale"
                      />
                    </div>
                  )}
                  {field.key === 'quality' &&
                    draftValues.qualityPreset !== undefined && (
                      <Select
                        value={draftValues.qualityPreset}
                        options={['none', 'light', 'standard'].map((value) => ({
                          label: value,
                          value,
                        }))}
                        onChange={(value) => setField('qualityPreset', value)}
                      />
                    )}
                  {field.key === 'quality' &&
                    draftValues.qualityToggle !== undefined && (
                      <Checkbox
                        checked={draftValues.qualityToggle}
                        onChange={(event) =>
                          setField('qualityToggle', event.target.checked)
                        }
                      >
                        {t('自动质量标签')}
                      </Checkbox>
                    )}
                </>
              )}
            </div>
          ))}
        </div>
        <p className="studio-preset-hint">
          {t('套用到')} {presetProviderLabel(currentProvider)}{' '}
          {t('时会自动跳过不兼容的字段。')}
        </p>
      </Modal>
    </>
  )
}
