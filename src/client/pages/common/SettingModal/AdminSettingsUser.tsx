import { Button, Form, Input, message } from 'antd'
import type { FormInstance } from 'antd/es/form'

interface Props {
  form: FormInstance
  onSave: (token: string, userId: string) => void
}

function UserIdInput({
  value,
  onChange,
  onSave,
}: {
  value?: string
  onChange?: (v: string) => void
  onSave: () => void
}) {
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="请输入云雾用户 ID"
        className="flex-1"
      />
      <Button type="primary" onClick={onSave}>
        保存
      </Button>
    </div>
  )
}

export function AdminSettingsUser({ form, onSave }: Props) {
  const handleSaveUserSettings = async () => {
    try {
      const values = await form.validateFields(['yunwuSystemToken', 'yunwuUserId'])
      onSave(values.yunwuSystemToken, values.yunwuUserId)
      message.success('云雾用户设置已保存')
    } catch {
      // 表单验证失败，antd 会自动显示提示
    }
  }

  return (
    <>
      <div className="mb-4 text-sm font-medium text-gray-800">
        云雾用户设置
      </div>
      <Form.Item
        name="yunwuSystemToken"
        label="系统令牌"
        rules={[{ required: true, message: '请输入云雾系统令牌' }]}
      >
        <Input.Password placeholder="请输入云雾系统令牌" />
      </Form.Item>
      <Form.Item
        name="yunwuUserId"
        label="用户 ID"
        rules={[{ required: true, message: '请输入云雾用户 ID' }]}
      >
        <UserIdInput onSave={handleSaveUserSettings} />
      </Form.Item>
    </>
  )
}
