import { Form, Input, Modal, message } from 'antd'
import { hc } from 'hono/client'
import { useState } from 'react'
import type { AppType } from '../../../../../server'

const client = hc<AppType>('/')

interface RenameFolderModalProps {
  folder: string
  open: boolean
  onCancel: () => void
  onSuccess: (newFolder: string) => void
}

export function RenameFolderModal({
  folder,
  open,
  onCancel,
  onSuccess,
}: RenameFolderModalProps) {
  const [form] = Form.useForm<{ newFolder: string }>()
  const [submitting, setSubmitting] = useState(false)

  const handleRename = async () => {
    try {
      const values = await form.validateFields()
      const newFolder = values.newFolder.trim()
      setSubmitting(true)
      const res = await client.api.template.folder.rename.$put({
        json: {
          oldFolder: folder,
          newFolder,
        },
      })
      const json = await res.json()
      if (json.success) {
        message.success(`已重命名 ${json.data.updatedCount} 个模板`)
        onSuccess(json.data.newFolder)
      } else {
        message.error(json.error || '重命名失败')
      }
    } catch (error) {
      if (error instanceof Error) {
        message.error(`[网络] ${error.message || '重命名失败'}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="重命名文件夹"
      open={open}
      onOk={handleRename}
      onCancel={onCancel}
      confirmLoading={submitting}
      destroyOnHidden
      width={400}
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ newFolder: folder }}
      >
        <Form.Item
          name="newFolder"
          label="文件夹名称"
          rules={[
            {
              required: true,
              whitespace: true,
              message: '请输入文件夹名称',
            },
            { max: 100, message: '文件夹名称不能超过 100 个字符' },
            {
              validator: async (_, value) => {
                if (value?.trim() === folder) {
                  throw new Error('新名称不能与原名称相同')
                }
              },
            },
          ]}
        >
          <Input placeholder="输入新的文件夹名称" maxLength={100} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
