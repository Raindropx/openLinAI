import { Input, Select } from 'antd'
import type { CharacterCard } from '../../../utils/characterCard'

interface CharacterCardEditorFieldsProps {
  card: CharacterCard
  onChange: <K extends keyof CharacterCard>(
    key: K,
    value: CharacterCard[K],
  ) => void
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-sm font-medium text-slate-300">
      {children}
    </label>
  )
}

export function CharacterCardEditorFields({
  card,
  onChange,
}: CharacterCardEditorFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel>姓名 (name)</FieldLabel>
          <Input
            value={card.name}
            onChange={(event) => onChange('name', event.target.value)}
            placeholder="角色姓名"
          />
        </div>
        <div>
          <FieldLabel>标签 (tags)</FieldLabel>
          <Select
            mode="tags"
            value={card.tags}
            onChange={(value) => onChange('tags', value)}
            placeholder="输入标签后按回车添加"
            className="w-full"
            tokenSeparators={[',']}
          />
        </div>
      </div>

      <div>
        <FieldLabel>描述 (description)</FieldLabel>
        <Input.TextArea
          value={card.description}
          onChange={(event) => onChange('description', event.target.value)}
          autoSize={{ minRows: 4, maxRows: 14 }}
          placeholder="外貌描述、服装、显著特征等"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <FieldLabel>性格 (personality)</FieldLabel>
          <Input.TextArea
            value={card.personality}
            onChange={(event) => onChange('personality', event.target.value)}
            autoSize={{ minRows: 3, maxRows: 10 }}
            placeholder="性格特征"
          />
        </div>
        <div>
          <FieldLabel>场景 (scenario)</FieldLabel>
          <Input.TextArea
            value={card.scenario}
            onChange={(event) => onChange('scenario', event.target.value)}
            autoSize={{ minRows: 3, maxRows: 10 }}
            placeholder="初始场景设定"
          />
        </div>
      </div>

      <div>
        <FieldLabel>第一句话 (first_mes)</FieldLabel>
        <Input.TextArea
          value={card.first_mes}
          onChange={(event) => onChange('first_mes', event.target.value)}
          autoSize={{ minRows: 3, maxRows: 10 }}
          placeholder="角色的第一句话"
        />
      </div>

      <div>
        <FieldLabel>对话示例 (mes_example)</FieldLabel>
        <Input.TextArea
          value={card.mes_example}
          onChange={(event) => onChange('mes_example', event.target.value)}
          autoSize={{ minRows: 5, maxRows: 16 }}
          placeholder="使用 {{char}} 和 {{user}} 格式的示例对话"
        />
      </div>
    </div>
  )
}
