import { Input, Modal } from 'antd'
import { useEffect, useState } from 'react'

interface PromptOptimizeModalProps {
  open: boolean
  loading: boolean
  initialText?: string
  onCancel: () => void
  onAdopt: (text: string) => void
}

/**
 * 提示词优化结果预览弹框。
 * 显示 LLM 返回的优化后提示词，用户可编辑后「采纳」替换原文本，或「取消」保留原文本。
 */
export function PromptOptimizeModal({
  open,
  loading,
  initialText = '',
  onCancel,
  onAdopt,
}: PromptOptimizeModalProps) {
  const [text, setText] = useState(initialText)

  useEffect(() => {
    if (open) setText(initialText)
  }, [open, initialText])

  return (
    <Modal
      title="提示词优化结果"
      open={open}
      onCancel={onCancel}
      onOk={() => onAdopt(text)}
      okText="采纳"
      cancelText="取消"
      okButtonProps={{ disabled: loading || !text.trim() }}
      width={620}
      destroyOnHidden
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          正在优化提示词...
        </div>
      ) : (
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoSize={{ minRows: 8, maxRows: 20 }}
          style={{ resize: 'none' }}
          placeholder="优化后的提示词将显示在这里，可编辑后采纳"
        />
      )}
    </Modal>
  )
}
