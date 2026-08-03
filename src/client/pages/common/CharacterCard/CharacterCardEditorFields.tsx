import {
  DeleteOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Button, Input, Select } from 'antd'
import { useMemo, useState } from 'react'
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

// ── 对话示例气泡编辑器 ────────────────────────────────────

type MessageRole = 'char' | 'user'

interface ExampleMessage {
  role: MessageRole
  content: string
}

interface ExampleBlock {
  messages: ExampleMessage[]
}

const ROLE_LINE_REGEX = /^\s*\{\{(char|user)\}\}\s*:\s?(.*)$/i

/** 将 mes_example 字符串解析为对话分组 */
function parseMesExample(raw: string): ExampleBlock[] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks: ExampleBlock[] = []
  const sections = text.split(/<START>/i)
  for (const section of sections) {
    const lines = section.split('\n')
    const messages: ExampleMessage[] = []
    let current: ExampleMessage | null = null
    for (const line of lines) {
      const match = line.match(ROLE_LINE_REGEX)
      if (match) {
        if (current) messages.push(current)
        current = {
          role: match[1].toLowerCase() as MessageRole,
          content: match[2],
        }
      } else if (line.trim() && current) {
        current.content += `\n${line}`
      }
    }
    if (current) messages.push(current)
    if (messages.length > 0) blocks.push({ messages })
  }
  return blocks
}

/** 将对话分组序列化回 mes_example 字符串 */
function serializeMesExample(blocks: ExampleBlock[]): string {
  return blocks
    .map(
      (block) =>
        '<START>\n' +
        block.messages.map((m) => `{{${m.role}}}: ${m.content}`).join('\n'),
    )
    .join('\n')
}

function MesExampleEditor({
  value,
  cardName,
  onChange,
}: {
  value: string
  cardName: string
  onChange: (value: string) => void
}) {
  const blocks = useMemo(() => parseMesExample(value), [value])
  const [focusKey, setFocusKey] = useState<string | null>(null)

  const totalMessages = blocks.reduce((sum, b) => sum + b.messages.length, 0)

  const updateMessage = (
    blockIndex: number,
    messageIndex: number,
    content: string,
  ) => {
    const next = blocks.map((block, bi) => ({
      messages:
        bi === blockIndex
          ? block.messages.map((msg, mi) =>
              mi === messageIndex ? { ...msg, content } : msg,
            )
          : block.messages.slice(),
    }))
    onChange(serializeMesExample(next))
  }

  const deleteMessage = (blockIndex: number, messageIndex: number) => {
    const next = blocks
      .map((block, bi) => ({
        messages:
          bi === blockIndex
            ? block.messages.filter((_, mi) => mi !== messageIndex)
            : block.messages.slice(),
      }))
      .filter((block) => block.messages.length > 0)
    onChange(serializeMesExample(next))
  }

  const insertMessage = (role: MessageRole) => {
    const next = blocks.map((block) => ({ messages: block.messages.slice() }))
    if (next.length === 0) {
      next.push({ messages: [{ role, content: '' }] })
    } else {
      next[next.length - 1].messages.push({ role, content: '' })
    }
    const bi = next.length - 1
    const mi = next[bi].messages.length - 1
    setFocusKey(`${bi}.${mi}`)
    onChange(serializeMesExample(next))
  }

  const charLabel = cardName || '{{char}}'

  return (
    <div className="rounded-lg border border-[#2d333d] bg-[#15181d] p-3">
      <div className="space-y-3">
        {blocks.map((block, bi) => (
          <div key={bi} className="space-y-2">
            {bi > 0 && (
              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-[#2d333d]" />
                <span className="text-[10px] tracking-widest text-slate-500">
                  新对话
                </span>
                <div className="h-px flex-1 bg-[#2d333d]" />
              </div>
            )}
            {block.messages.map((msg, mi) => {
              const isChar = msg.role === 'char'
              const key = `${bi}.${mi}`
              return (
                <div
                  key={key}
                  className={`group flex items-start gap-2 ${
                    isChar ? 'justify-start' : 'justify-end'
                  }`}
                >
                  {isChar && (
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/20">
                      <RobotOutlined className="text-sm" />
                    </div>
                  )}
                  <div
                    className={`relative flex max-w-[80%] flex-col rounded-2xl px-3 py-2 ${
                      isChar
                        ? 'rounded-tl-md bg-[#2a313b] text-slate-100'
                        : 'rounded-tr-md bg-amber-500/15 text-amber-50 ring-1 ring-amber-400/20'
                    }`}
                  >
                    <div
                      className={`mb-1 flex items-center gap-1.5 text-[11px] ${
                        isChar ? 'text-slate-400' : 'text-amber-200/70'
                      }`}
                    >
                      <span className="truncate">{isChar ? charLabel : '{{user}}'}</span>
                      <button
                        type="button"
                        aria-label="删除该条发言"
                        onClick={() => deleteMessage(bi, mi)}
                        className="cursor-pointer rounded p-0.5 text-slate-500 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
                      >
                        <DeleteOutlined className="text-[11px]" />
                      </button>
                    </div>
                    <Input.TextArea
                      value={msg.content}
                      onChange={(event) =>
                        updateMessage(bi, mi, event.target.value)
                      }
                      autoFocus={focusKey === key}
                      variant="borderless"
                      autoSize={{ minRows: 1, maxRows: 10 }}
                      placeholder="输入对话内容…"
                      className={`p-0! text-sm! ${
                        isChar ? 'text-slate-100!' : 'text-amber-50!'
                      }`}
                    />
                  </div>
                  {!isChar && (
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20">
                      <UserOutlined className="text-sm" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {totalMessages === 0 && (
          <div className="rounded-lg border border-dashed border-[#2d333d] py-6 text-center text-xs text-slate-500">
            暂无对话示例，点击下方按钮添加角色或用户发言
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            icon={<RobotOutlined />}
            onClick={() => insertMessage('char')}
          >
            插入角色发言
          </Button>
          <Button icon={<UserOutlined />} onClick={() => insertMessage('user')}>
            插入用户发言
          </Button>
        </div>
      </div>
    </div>
  )
}

export function CharacterCardEditorFields({
  card,
  onChange,
}: CharacterCardEditorFieldsProps) {
  // 仅当 mes_example 符合 SillyTavern 气泡格式（或为空）时启用气泡编辑器，
  // 其它自由文本回退为普通文本域以避免数据丢失
  const isBubbleFormat =
    card.mes_example.trim() === '' ||
    /<START>|{{char}}:|{{user}}:/i.test(card.mes_example)

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
        {isBubbleFormat ? (
          <MesExampleEditor
            value={card.mes_example}
            cardName={card.name}
            onChange={(value) => onChange('mes_example', value)}
          />
        ) : (
          <Input.TextArea
            value={card.mes_example}
            onChange={(event) => onChange('mes_example', event.target.value)}
            autoSize={{ minRows: 5, maxRows: 16 }}
            placeholder="使用 {{char}} 和 {{user}} 格式的示例对话"
          />
        )}
      </div>
    </div>
  )
}
