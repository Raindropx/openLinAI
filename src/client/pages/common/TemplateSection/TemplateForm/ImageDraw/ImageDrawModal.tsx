import { Button, Modal } from 'antd'
import { ImageDrawToolbar } from './ImageDrawToolbar'
import { ImageDrawViewport } from './ImageDrawViewport'
import { useImageDrawEditor } from './useImageDrawEditor'

interface ImageDrawModalProps {
  open: boolean
  src: string | null
  onCancel: () => void
  onConfirm: (dataUrl: string) => Promise<void>
  onConfirmCopy: (dataUrl: string) => Promise<void>
}

export function ImageDrawModal({
  open,
  src,
  onCancel,
  onConfirm,
  onConfirmCopy,
}: ImageDrawModalProps) {
  const editor = useImageDrawEditor({
    open,
    src,
    onConfirm,
    onConfirmCopy,
  })

  return (
    <Modal
      title="涂抹图片"
      open={open}
      width={800}
      destroyOnHidden
      mask={{ closable: !editor.modal.submitting }}
      keyboard={!editor.modal.submitting}
      closable={!editor.modal.submitting}
      onCancel={() => {
        if (!editor.modal.submitting) onCancel()
      }}
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          <Button disabled={editor.modal.submitting} onClick={onCancel}>
            取消
          </Button>
          <div className="flex gap-2">
            <Button
              loading={editor.modal.submittingAction === 'copy'}
              disabled={editor.modal.submitting || !editor.modal.canConfirm}
              onClick={editor.modal.onConfirmCopy}
            >
              提交副本
            </Button>
            <Button
              type="primary"
              loading={editor.modal.submittingAction === 'replace'}
              disabled={editor.modal.submitting || !editor.modal.canConfirm}
              onClick={editor.modal.onConfirm}
            >
              提交
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex min-h-0 flex-col gap-3">
        <ImageDrawToolbar {...editor.toolbarProps} />
        <ImageDrawViewport {...editor.viewportProps} />
      </div>
    </Modal>
  )
}
