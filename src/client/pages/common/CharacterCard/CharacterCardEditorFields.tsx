import {
  DeleteOutlined,
  LoadingOutlined,
  RobotOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Button, Checkbox, Input, message, Select } from 'antd'
import { useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../../../hooks/useChatCompletion'
import type { CharacterCard } from '../../../utils/characterCard'

interface CharacterCardEditorFieldsProps {
  card: CharacterCard
  endpointId?: string
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

/** 构建续写示例对话的系统提示词 */
function buildContinuationPrompt(
  card: CharacterCard,
  dialogue: string,
  role: MessageRole,
): string {
  const roleLabel =
    role === 'char' ? `角色（${card.name || '{{char}}'}）` : '用户（{{user}}）'

  return `你是一个角色扮演对话示例续写助手。请根据以下角色卡信息和已有对话上下文，续写一条对话发言。

【角色卡信息】
姓名：${card.name || '未命名'}
描述：${card.description || '无'}
性格：${card.personality || '无'}
场景：${card.scenario || '无'}
角色第一句话：${card.first_mes || '无'}

【已有对话示例】
${dialogue || '（暂无对话）'}

【任务】
请以 ${roleLabel} 的身份，结合角色性格和对话上下文，续写一条自然、符合角色设定的对话发言。

要求：
1. 只输出发言内容本身，不要包含角色名或任何前缀
2. 不要输出任何解释、说明或元信息
3. 内容应当自然衔接已有对话
4. 发言长度适中（1-3句话），符合角色说话风格`
}

/** 带中断支持的 LLM 请求 */
async function requestChatCompletionWithAbort(
  endpointId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpointId, messages }),
    signal,
  })

  const data: any = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
        data?.error ||
        data?.message ||
        `请求失败 (${res.status})`,
    )
  }

  const content = data?.choices?.[0]?.message?.content
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
  }
  if (typeof content === 'string') {
    return content
  }
  throw new Error('模型未返回有效文本')
}

function MesExampleEditor({
  value,
  card,
  endpointId,
  onChange,
}: {
  value: string
  card: CharacterCard
  endpointId?: string
  onChange: (value: string) => void
}) {
  const blocks = useMemo(() => parseMesExample(value), [value])
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [aiMode, setAiMode] = useState(false)
  const [generatingRole, setGeneratingRole] = useState<MessageRole | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

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

  const handleStop = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setGeneratingRole(null)
  }

  const handleAiInsert = async (role: MessageRole) => {
    if (!endpointId) {
      message.warning('请先在设置中配置 LLM 端点')
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller
    setGeneratingRole(role)

    try {
      const dialogue = value.trim()
      const systemContent = buildContinuationPrompt(card, dialogue, role)
      const roleLabel = role === 'char' ? card.name || '{{char}}' : '{{user}}'

      const messages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: `请以 ${roleLabel} 的身份续写一条对话发言。`,
        },
      ]

      const reply = await requestChatCompletionWithAbort(
        endpointId,
        messages,
        controller.signal,
      )
      const content = reply.trim()

      if (!content) {
        message.warning('AI 返回内容为空')
        return
      }

      // 将 AI 生成的内容作为新发言追加
      const next = blocks.map((block) => ({
        messages: block.messages.slice(),
      }))
      if (next.length === 0) {
        next.push({ messages: [{ role, content }] })
      } else {
        next[next.length - 1].messages.push({ role, content })
      }
      onChange(serializeMesExample(next))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      message.error(error instanceof Error ? error.message : 'AI 续写失败')
    } finally {
      abortControllerRef.current = null
      setGeneratingRole(null)
    }
  }

  const handleInsert = (role: MessageRole) => {
    if (generatingRole) return
    if (aiMode) {
      handleAiInsert(role)
    } else {
      insertMessage(role)
    }
  }

  const charLabel = card.name || '{{char}}'

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
                    className={`relative flex w-[min(75%,48rem)] min-w-0 flex-col rounded-2xl px-3 py-2 ${
                      isChar
                        ? 'rounded-tl-md bg-[#2a313b] text-slate-100'
                        : 'app-accent-message rounded-tr-md'
                    }`}
                  >
                    <div
                      className={`mb-1 flex items-center gap-1.5 text-[11px] ${
                        isChar ? 'text-slate-400' : 'app-accent-text'
                      }`}
                    >
                      <span className="truncate">
                        {isChar ? charLabel : '{{user}}'}
                      </span>
                      <button
                        type="button"
                        aria-label="删除该条发言"
                        onClick={() => deleteMessage(bi, mi)}
                        className="cursor-pointer rounded p-0.5 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-300"
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
                      autoSize={{ minRows: 1 }}
                      placeholder="输入对话内容…"
                      className={`w-full! min-w-0! p-0! text-sm! ${
                        isChar ? 'text-slate-100!' : 'app-accent-field'
                      }`}
                    />
                  </div>
                  {!isChar && (
                    <div className="app-accent-surface mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                      <UserOutlined className="text-sm" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {/* AI 续写中的占位气泡 */}
        {generatingRole && (
          <div
            className={`group flex items-start gap-2 ${
              generatingRole === 'char' ? 'justify-start' : 'justify-end'
            }`}
          >
            {generatingRole === 'char' && (
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/20">
                <RobotOutlined className="text-sm" />
              </div>
            )}
            <div
              className={`relative flex w-fit max-w-[85%] flex-col rounded-2xl px-3 py-2 ${
                generatingRole === 'char'
                  ? 'rounded-tl-md bg-[#2a313b] text-slate-100'
                  : 'app-accent-message rounded-tr-md'
              }`}
            >
              <div
                className={`mb-1 flex items-center gap-1.5 text-[11px] ${
                  generatingRole === 'char'
                    ? 'text-slate-400'
                    : 'app-accent-text'
                }`}
              >
                <span className="truncate">
                  {generatingRole === 'char' ? charLabel : '{{user}}'}
                </span>
              </div>
              <div className="flex items-center gap-2 py-1 text-xs text-slate-400">
                <LoadingOutlined />
                <span>AI 续写中…</span>
                <button
                  type="button"
                  onClick={handleStop}
                  className="cursor-pointer rounded px-1.5 py-0.5 text-rose-300 transition-colors hover:bg-rose-500/10"
                >
                  <StopOutlined /> 停止
                </button>
              </div>
            </div>
            {generatingRole === 'user' && (
              <div className="app-accent-surface mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                <UserOutlined className="text-sm" />
              </div>
            )}
          </div>
        )}

        {totalMessages === 0 && !generatingRole && (
          <div className="rounded-lg border border-dashed border-[#2d333d] py-6 text-center text-xs text-slate-500">
            暂无对话示例，点击下方按钮添加角色或用户发言
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            icon={<RobotOutlined />}
            onClick={() => handleInsert('char')}
            disabled={generatingRole !== null}
          >
            插入角色发言
          </Button>
          <Button
            icon={<UserOutlined />}
            onClick={() => handleInsert('user')}
            disabled={generatingRole !== null}
          >
            插入用户发言
          </Button>
          <Checkbox
            checked={aiMode}
            onChange={(e) => setAiMode(e.target.checked)}
            disabled={generatingRole !== null}
            className="ml-1"
          >
            AI续写
          </Checkbox>
        </div>
      </div>
    </div>
  )
}

export function CharacterCardEditorFields({
  card,
  endpointId,
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
            card={card}
            endpointId={endpointId}
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
