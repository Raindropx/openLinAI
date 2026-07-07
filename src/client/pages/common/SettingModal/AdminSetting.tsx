import { Button, Form, Input, message } from 'antd'
import { hc } from 'hono/client'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { AppType } from '../../../../server'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { AdminSettingsCollapse } from './AdminSettingsCollapse'
import { AdminSettingsGroup } from './AdminSettingsGroup'
import { AdminSettingsUser } from './AdminSettingsUser'
import type { GenerateApiKeyResponse } from './types'

export interface AdminSettingRef {
  save: () => Promise<void>
}

const client = hc<AppType>('/')

export const AdminSetting = forwardRef<AdminSettingRef>((_props, ref) => {
  const [form] = Form.useForm()
  const { yunwuSystemToken, setYunwuSystemToken, yunwuUserId, setYunwuUserId } =
    useLocalSetting()
  const [loading, setLoading] = useState(false)
  const [generatedApiKey, setGeneratedApiKey] = useState<string>('')
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null)

  useEffect(() => {
    form.setFieldsValue({
      yunwuSystemToken: yunwuSystemToken || '',
      name: '',
      quota: 10,
    })
  }, [yunwuSystemToken, form])

  useImperativeHandle(ref, () => ({
    save: async () => {
      const values = await form.validateFields()
      setYunwuSystemToken(values.yunwuSystemToken)
      setYunwuUserId(values.yunwuUserId)
    },
  }))

  const handleSaveUser = (token: string, userId: string) => {
    setYunwuSystemToken(token)
    setYunwuUserId(userId)
  }

  const handleGenerate = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      setGeneratedApiKey('')

      const response = await client.api.gptImage['generate-api-key'].$post({
        json: {
          systemToken: values.yunwuSystemToken,
          userId: values.yunwuUserId,
          name: values.name,
          quota: Number(values.quota),
          group: '',
        },
      })
      const data = (await response.json()) as GenerateApiKeyResponse

      if (data.success || data.data) {
        message.success('API Key 生成成功')
        setGeneratedApiKey(typeof data.data === 'string' ? data.data : '')
      } else {
        message.error(data.message || '生成失败')
      }
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '请求失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Form
        key={yunwuUserId ?? 'empty'}
        form={form}
        layout="vertical"
        initialValues={{
          yunwuSystemToken: yunwuSystemToken || '',
          yunwuUserId: yunwuUserId || '',
        }}
      >
        <AdminSettingsUser form={form} onSave={handleSaveUser} />

        <AdminSettingsCollapse
          yunwuSystemToken={yunwuSystemToken}
          yunwuUserId={yunwuUserId}
          onGenerate={handleGenerate}
          loading={loading}
          onSelectToken={setSelectedTokenId}
        />

        <AdminSettingsGroup
          yunwuSystemToken={yunwuSystemToken}
          yunwuUserId={yunwuUserId}
          selectedTokenId={selectedTokenId}
        />
      </Form>

      {generatedApiKey && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4">
          <div className="mb-2 text-sm font-medium text-green-800">
            生成成功！请妥善保存您的 API Key：
          </div>
          <div className="flex items-center gap-2">
            <Input value={generatedApiKey} readOnly />
            <Button
              onClick={() => {
                navigator.clipboard.writeText(generatedApiKey)
                message.success('已复制到剪贴板')
              }}
            >
              复制
            </Button>
          </div>
        </div>
      )}
    </div>
  )
})
