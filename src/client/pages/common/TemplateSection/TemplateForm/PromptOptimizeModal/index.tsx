import { Image as AntImage, Button, Input, Modal, message } from 'antd'
import { hc } from 'hono/client'
import { useEffect, useMemo, useState } from 'react'
import type { AppType } from '../../../../../../server'

const client = hc<AppType>('/')

const PROMPT_OPTIMIZE_MODEL = 'gemini-3.1-flash-lite'
const PROMPT_TEMPLATE = '{{ USER_PROMPT }}'

interface PromptOptimizeModalProps {
  open: boolean
  prompt: string
  imageUrls: string[]
  onClose: () => void
  onApply: (optimizedPrompt: string) => void
}

function PreviewImages({ imageUrls }: { imageUrls: string[] }) {
  if (imageUrls.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
        当前没有输入图片
      </div>
    )
  }

  return (
    <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
      {imageUrls.map((url, index) => (
        <div
          key={`${url}-${index}`}
          className="relative shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm"
          style={{ width: '80px', height: '120px' }}
        >
          <AntImage
            src={url}
            alt={`prompt-optimize-preview-${index}`}
            width={80}
            height={120}
            className="object-cover"
            preview={{ src: url }}
          />
        </div>
      ))}
    </div>
  )
}

function extractOptimizedPrompt(data: any) {
  const content = data?.choices?.[0]?.message?.content

  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

export function PromptOptimizeModal({
  open,
  prompt,
  imageUrls,
  onClose,
  onApply,
}: PromptOptimizeModalProps) {
  const [sourcePrompt, setSourcePrompt] = useState(prompt)
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (open) {
      setSourcePrompt(prompt)
      setOptimizedPrompt('')
    }
  }, [open, prompt])

  const renderedTemplate = useMemo(
    () => PROMPT_TEMPLATE.replace('{{ USER_PROMPT }}', sourcePrompt),
    [sourcePrompt],
  )

  const handleGenerate = async () => {
    const trimmedPrompt = sourcePrompt.trim()
    if (!trimmedPrompt) {
      message.warning('请先填写原始提示词')
      return
    }

    setGenerating(true)
    try {
      const res = await client.api.chat.completions.$post({
        json: {
          model: PROMPT_OPTIMIZE_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: renderedTemplate,
                },
                ...imageUrls.map((url) => ({
                  type: 'image_url' as const,
                  image_url: { url },
                })),
              ],
            },
          ],
        },
      })

      const data = await res.json()
      if (!res.ok) {
        message.error((data as any)?.error || '提示词优化失败')
        return
      }

      const nextPrompt = extractOptimizedPrompt(data)
      if (!nextPrompt) {
        message.error('未获取到优化后的提示词')
        return
      }

      setOptimizedPrompt(nextPrompt)
      message.success('提示词优化成功')
    } catch (error) {
      message.error('提示词优化请求失败')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Modal
      title="提示词优化"
      open={open}
      onCancel={() => {
        if (!generating) {
          onClose()
        }
      }}
      destroyOnHidden
      width={720}
      footer={
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} disabled={generating}>
            取消
          </Button>
          <Button type="primary" onClick={handleGenerate} loading={generating}>
            生成
          </Button>
          <Button
            onClick={() => onApply(optimizedPrompt)}
            disabled={!optimizedPrompt || generating}
          >
            应用
          </Button>
        </div>
      }
    >
      <div className="mt-4 space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">
            原始提示词
          </div>
          <Input.TextArea
            value={sourcePrompt}
            onChange={(event) => setSourcePrompt(event.target.value)}
            rows={5}
            placeholder="请输入原始提示词"
            style={{ resize: 'none' }}
          />
          <PreviewImages imageUrls={imageUrls} />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">
            模板内容
          </div>
          <Input.TextArea
            value={PROMPT_TEMPLATE}
            readOnly
            rows={3}
            style={{ resize: 'none' }}
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">
            优化结果
          </div>
          <Input.TextArea
            value={optimizedPrompt}
            readOnly
            rows={5}
            placeholder="点击生成后展示优化后的提示词"
            style={{ resize: 'none' }}
          />
        </div>
      </div>
    </Modal>
  )
}
