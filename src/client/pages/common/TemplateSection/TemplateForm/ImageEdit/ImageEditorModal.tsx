import { Button, Modal } from 'antd'
import { ImageDrawToolbar } from './ImageDrawToolbar'
import { ImageEditorViewport } from './ImageEditorViewport'
import { ImageTransformToolbar } from './ImageTransformToolbar'
import { useImageEditor } from './useImageEditor'

interface ImageEditorModalProps {
  open: boolean
  src: string | null
  onCancel: () => void
  onConfirm: (dataUrl: string) => Promise<void>
  onConfirmCopy: (dataUrl: string) => Promise<void>
}

export function ImageEditorModal({
  open,
  src,
  onCancel,
  onConfirm,
  onConfirmCopy,
}: ImageEditorModalProps) {
  const editor = useImageEditor({
    open,
    src,
    onConfirm,
    onConfirmCopy,
  })

  return (
    <Modal
      title="编辑图片"
      open={open}
      width={900}
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
        <ImageDrawToolbar {...editor.drawToolbarProps} />
        <ImageEditorViewport {...editor.viewportProps} />
        <ImageTransformToolbar {...editor.transformToolbarProps} />
      </div>
    </Modal>
  )
}
