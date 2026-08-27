import { Input, Modal } from 'antd'
import { useMemo } from 'react'

type ChangeKind = 'changed' | 'added' | 'removed'
type TextSegmentKind = 'equal' | 'removed' | 'added'

interface JsonFieldChange {
  path: string
  kind: ChangeKind
  before?: unknown
  after?: unknown
}

interface TextSegment {
  kind: TextSegmentKind
  text: string
  collapsed?: boolean
}

interface CharacterCardAiEditModalProps {
  open: boolean
  loading: boolean
  instructions: string
  originalJson: string
  proposedJson?: string
  onInstructionsChange: (value: string) => void
  onGenerate: () => void
  onAccept: () => void
  onDiscard: () => void
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function appendSegment(
  segments: TextSegment[],
  kind: TextSegmentKind,
  text: string,
) {
  if (!text) return
  const previous = segments[segments.length - 1]
  if (previous?.kind === kind && !previous.collapsed) {
    previous.text += text
  } else {
    segments.push({ kind, text })
  }
}

function compactEqualSegments(segments: TextSegment[]): TextSegment[] {
  return segments.flatMap((segment) => {
    if (segment.kind !== 'equal' || segment.text.length <= 240) {
      return [segment]
    }

    const contextLength = 100
    const hiddenLength = segment.text.length - contextLength * 2
    return [
      { kind: 'equal' as const, text: segment.text.slice(0, contextLength) },
      {
        kind: 'equal' as const,
        text: `\n… 已折叠 ${hiddenLength} 个未修改字符 …\n`,
        collapsed: true,
      },
      { kind: 'equal' as const, text: segment.text.slice(-contextLength) },
    ]
  })
}

function tokenize(text: string): string[] {
  return text.match(/[\p{Script=Han}]|[A-Za-z0-9_]+|\s+|./gu) ?? []
}

function buildLargeTextDiff(before: string[], after: string[]) {
  let prefixLength = 0
  while (
    prefixLength < before.length &&
    prefixLength < after.length &&
    before[prefixLength] === after[prefixLength]
  ) {
    prefixLength += 1
  }

  let oldSuffixStart = before.length
  let newSuffixStart = after.length
  while (
    oldSuffixStart > prefixLength &&
    newSuffixStart > prefixLength &&
    before[oldSuffixStart - 1] === after[newSuffixStart - 1]
  ) {
    oldSuffixStart -= 1
    newSuffixStart -= 1
  }

  const beforeSegments: TextSegment[] = []
  const afterSegments: TextSegment[] = []
  appendSegment(beforeSegments, 'equal', before.slice(0, prefixLength).join(''))
  appendSegment(afterSegments, 'equal', after.slice(0, prefixLength).join(''))
  appendSegment(
    beforeSegments,
    'removed',
    before.slice(prefixLength, oldSuffixStart).join(''),
  )
  appendSegment(
    afterSegments,
    'added',
    after.slice(prefixLength, newSuffixStart).join(''),
  )
  appendSegment(beforeSegments, 'equal', before.slice(oldSuffixStart).join(''))
  appendSegment(afterSegments, 'equal', after.slice(newSuffixStart).join(''))

  return {
    beforeSegments: compactEqualSegments(beforeSegments),
    afterSegments: compactEqualSegments(afterSegments),
  }
}

function buildTextDiff(beforeText: string, afterText: string) {
  const before = tokenize(beforeText)
  const after = tokenize(afterText)

  // 大字段退化为共同前后缀比较，避免字符级 LCS 占用过多内存。
  if (before.length * after.length > 1_000_000) {
    return buildLargeTextDiff(before, after)
  }

  const lcs = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(after.length + 1),
  )
  for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = after.length - 1; newIndex >= 0; newIndex -= 1) {
      lcs[oldIndex][newIndex] =
        before[oldIndex] === after[newIndex]
          ? lcs[oldIndex + 1][newIndex + 1] + 1
          : Math.max(lcs[oldIndex + 1][newIndex], lcs[oldIndex][newIndex + 1])
    }
  }

  const beforeSegments: TextSegment[] = []
  const afterSegments: TextSegment[] = []
  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < before.length && newIndex < after.length) {
    if (before[oldIndex] === after[newIndex]) {
      appendSegment(beforeSegments, 'equal', before[oldIndex])
      appendSegment(afterSegments, 'equal', after[newIndex])
      oldIndex += 1
      newIndex += 1
    } else if (lcs[oldIndex + 1][newIndex] >= lcs[oldIndex][newIndex + 1]) {
      appendSegment(beforeSegments, 'removed', before[oldIndex])
      oldIndex += 1
    } else {
      appendSegment(afterSegments, 'added', after[newIndex])
      newIndex += 1
    }
  }
  while (oldIndex < before.length) {
    appendSegment(beforeSegments, 'removed', before[oldIndex])
    oldIndex += 1
  }
  while (newIndex < after.length) {
    appendSegment(afterSegments, 'added', after[newIndex])
    newIndex += 1
  }

  return {
    beforeSegments: compactEqualSegments(beforeSegments),
    afterSegments: compactEqualSegments(afterSegments),
  }
}

function collectJsonChanges(
  before: unknown,
  after: unknown,
  path = '',
): JsonFieldChange[] {
  if (Object.is(before, after)) return []

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [
      ...Object.keys(before),
      ...Object.keys(after).filter((key) => !(key in before)),
    ]
    return keys.flatMap((key) => {
      const childPath = path ? `${path}.${key}` : key
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key)
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key)
      if (!hasBefore) {
        return [{ path: childPath, kind: 'added', after: after[key] }]
      }
      if (!hasAfter) {
        return [{ path: childPath, kind: 'removed', before: before[key] }]
      }
      return collectJsonChanges(before[key], after[key], childPath)
    })
  }

  if (JSON.stringify(before) === JSON.stringify(after)) return []
  return [{ path: path || '$', kind: 'changed', before, after }]
}

function formatJsonValue(value: unknown): string {
  if (typeof value === 'string') return value || '（空字符串）'
  return JSON.stringify(value, null, 2) ?? String(value)
}

const segmentStyles: Record<TextSegmentKind, string> = {
  equal: '',
  removed: 'rounded-sm bg-red-500/25 text-red-200',
  added: 'rounded-sm bg-emerald-500/25 text-emerald-200',
}

function DiffValue({ segments }: { segments: TextSegment[] }) {
  return (
    <div className="min-h-16 break-words whitespace-pre-wrap">
      {segments.map((segment, index) => (
        <span
          key={index}
          className={
            segment.collapsed
              ? 'text-slate-500 italic'
              : segmentStyles[segment.kind]
          }
        >
          {segment.text}
        </span>
      ))}
    </div>
  )
}

const changeLabels: Record<ChangeKind, string> = {
  changed: '修改',
  added: '新增字段',
  removed: '删除字段',
}

const changeLabelStyles: Record<ChangeKind, string> = {
  changed: 'bg-amber-500/10 text-amber-300',
  added: 'bg-emerald-500/10 text-emerald-300',
  removed: 'bg-red-500/10 text-red-300',
}

function JsonFieldDiff({ change }: { change: JsonFieldChange }) {
  const beforeText =
    change.kind === 'added' ? '（不存在）' : formatJsonValue(change.before)
  const afterText =
    change.kind === 'removed' ? '（不存在）' : formatJsonValue(change.after)
  const { beforeSegments, afterSegments } = useMemo(
    () => buildTextDiff(beforeText, afterText),
    [afterText, beforeText],
  )

  return (
    <section className="overflow-hidden rounded-lg border border-[#343a44] bg-[#111419]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#343a44] bg-[#181c22] px-3 py-2">
        <code className="text-xs font-semibold break-all text-slate-200">
          {change.path}
        </code>
        <span
          className={`rounded px-2 py-0.5 text-[11px] ${changeLabelStyles[change.kind]}`}
        >
          {changeLabels[change.kind]}
        </span>
      </div>
      <div className="grid md:grid-cols-2">
        <div className="border-b border-[#343a44] p-3 font-mono text-xs leading-5 text-slate-300 md:border-r md:border-b-0">
          <div className="mb-2 font-sans text-[11px] text-red-300">修改前</div>
          <DiffValue segments={beforeSegments} />
        </div>
        <div className="p-3 font-mono text-xs leading-5 text-slate-300">
          <div className="mb-2 font-sans text-[11px] text-emerald-300">
            修改后
          </div>
          <DiffValue segments={afterSegments} />
        </div>
      </div>
    </section>
  )
}

export function CharacterCardAiEditModal({
  open,
  loading,
  instructions,
  originalJson,
  proposedJson,
  onInstructionsChange,
  onGenerate,
  onAccept,
  onDiscard,
}: CharacterCardAiEditModalProps) {
  const changes = useMemo(() => {
    if (!proposedJson) return []
    try {
      return collectJsonChanges(
        JSON.parse(originalJson),
        JSON.parse(proposedJson),
      )
    } catch {
      return []
    }
  }, [originalJson, proposedJson])
  const reviewing = Boolean(proposedJson)
  const modifiedCount = changes.filter(
    (change) => change.kind === 'changed',
  ).length
  const addedCount = changes.filter((change) => change.kind === 'added').length
  const removedCount = changes.filter(
    (change) => change.kind === 'removed',
  ).length

  return (
    <Modal
      title={reviewing ? '审查 AI 修改' : 'AI 修改角色卡'}
      open={open}
      centered
      width="min(1000px, calc(100vw - 24px))"
      okText={reviewing ? '保留更改' : '生成修改'}
      cancelText={reviewing ? '丢弃更改' : '取消'}
      confirmLoading={loading}
      okButtonProps={{
        disabled: loading || (!reviewing && !instructions.trim()),
      }}
      cancelButtonProps={{ disabled: loading }}
      closable={!loading}
      mask={{ closable: !loading }}
      keyboard={!loading}
      onOk={reviewing ? onAccept : onGenerate}
      onCancel={onDiscard}
      destroyOnHidden
    >
      {reviewing ? (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-slate-700/70 px-2 py-1 text-slate-200">
              JSON Diff · {changes.length} 个字段
            </span>
            {modifiedCount > 0 && (
              <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">
                修改 {modifiedCount}
              </span>
            )}
            {addedCount > 0 && (
              <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-300">
                新增 {addedCount}
              </span>
            )}
            {removedCount > 0 && (
              <span className="rounded bg-red-500/10 px-2 py-1 text-red-300">
                删除 {removedCount}
              </span>
            )}
          </div>
          {changes.length > 0 ? (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {changes.map((change) => (
                <JsonFieldDiff key={change.path} change={change} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[#343a44] py-10 text-center text-sm text-slate-500">
              AI 返回的角色卡与当前内容没有可见差异
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500">
            按字段拆分显示；红色和绿色标出字段内部的实际变化，过长的未修改内容会自动折叠。
          </div>
        </div>
      ) : (
        <div className="pb-5">
          <div className="mb-2 text-sm text-slate-400">修改要求</div>
          <Input.TextArea
            value={instructions}
            onChange={(event) => onInstructionsChange(event.target.value)}
            autoSize={{ minRows: 4, maxRows: 10 }}
            placeholder="例如：把名字改成小云；或调整角色的性取向，并自然更新相关设定。"
            maxLength={2000}
            showCount
            autoFocus
            disabled={loading}
          />
          <div className="mt-7 text-xs leading-5 text-slate-500">
            AI 会读取当前完整角色卡，只修改要求涉及的内容，并在下一步展示 JSON
            差异供你确认。
          </div>
        </div>
      )}
    </Modal>
  )
}
