import { CopyOutlined, ToolOutlined } from '@ant-design/icons'
import { Button, Form, Input, message } from 'antd'
import { hc } from 'hono/client'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { AppType } from '../../../../server'
import { encryptApiKey } from '../../../../server/module/gpt-image/encrypt'
import { useLocalSetting } from '../../../hooks/useLocalSetting'
import { AdminSettingsCollapse } from './AdminSettingsCollapse'
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
  const [generatedApiKey, setGeneratedApiKey] = useState<string>('')
  const [loading, setLoading] = useState(false)

  // Encrypt tool state
  const [rawApiKey, setRawApiKey] = useState('')
  const [encryptedApiKey, setEncryptedApiKey] = useState('')
  const [encrypting, setEncrypting] = useState(false)

  useEffect(() => {
    form.setFieldsValue({
      yunwuSystemToken: yunwuSystemToken || '',
      yunwuUserId: yunwuUserId || '',
    })
  }, [yunwuSystemToken, yunwuUserId, form])

  useImperativeHandle(ref, () => ({
    save: async () => {
      // Admin settings are auto-saved via handleSaveUser
    },
  }))

  const handleSaveUser = (token: string, userId: string) => {
    setYunwuSystemToken(token)
    setYunwuUserId(userId)
  }

  const handleGenerate = async (name: string, quota: number, group: string) => {
    if (!yunwuSystemToken || !yunwuUserId) {
      message.warning('请先配置云雾用户设置')
      return
    }
    setLoading(true)
    setGeneratedApiKey('')
    try {
      const response = await client.api.gptImage['generate-api-key'].$post(
        {
          json: {
            systemToken: yunwuSystemToken,
            userId: yunwuUserId,
            name,
            quota,
            group,
          },
        },
        {
          headers: {
            'x-system-token': yunwuSystemToken,
            'x-user-id': yunwuUserId,
          },
        },
      )
      const data = (await response.json()) as GenerateApiKeyResponse
      if (data.success && data.data) {
        setGeneratedApiKey(data.data)
        message.success('API Key 生成成功')
      } else {
        message.error(data.message || '生成失败')
      }
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '请求失败')
    } finally {
      setLoading(false)
    }
  }

  const handleEncrypt = async () => {
    if (!rawApiKey) {
      message.warning('请输入 API Key')
      return
    }
    setEncrypting(true)
    try {
      const result = encryptApiKey(rawApiKey)
      setEncryptedApiKey(result)
      message.success('转换成功')
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '转换失败')
    } finally {
      setEncrypting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Prerequisite: 云雾用户设置 */}
      <Form
        key={yunwuUserId ?? 'empty'}
        form={form}
        layout="vertical"
        initialValues={{
          yunwuSystemToken: yunwuSystemToken || '',
          yunwuUserId: yunwuUserId || '',
        }}
        style={{ marginBottom: 16 }}
      >
        <AdminSettingsUser
          form={form}
          onSave={handleSaveUser}
          token={yunwuSystemToken}
          userId={yunwuUserId}
        />
      </Form>

      {/* Gated: API Key 管理 */}
      <AdminSettingsCollapse
        yunwuSystemToken={yunwuSystemToken}
        yunwuUserId={yunwuUserId}
        onGenerate={handleGenerate}
        loading={loading}
      />

      {/* Generated API Key success notification */}
      {generatedApiKey && (
        <div className="rounded-lg border border-green-400/25 bg-green-400/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-lg">✅</span>
            <span className="text-sm font-medium text-green-300">
              API Key 生成成功
            </span>
          </div>
          <div className="mb-2 text-xs text-green-400">
            请妥善保存，此 Key 关闭后将无法再次查看
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={generatedApiKey}
              readOnly
              className="font-mono text-xs"
            />
            <Button
              icon={<CopyOutlined />}
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

      {/* Tools: 加密转换 (client-side, no token needed) */}
      <div className="rounded-lg border border-white/10 bg-white/[0.025]">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
          <ToolOutlined className="text-base text-slate-500" />
          <span className="text-sm font-medium text-slate-200">工具</span>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="text-xs text-slate-400">API Key 加密转换</div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input.Password
                placeholder="输入原始 API Key"
                value={rawApiKey}
                onChange={(e) => setRawApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <Button type="primary" onClick={handleEncrypt} loading={encrypting}>
              转换
            </Button>
          </div>
          {encryptedApiKey && (
            <div className="rounded-md border border-blue-400/20 bg-blue-400/10 p-3">
              <div className="mb-1 text-xs text-blue-300">加密结果</div>
              <div className="font-mono text-xs break-all text-slate-300">
                {encryptedApiKey}
              </div>
              <Button
                type="link"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(encryptedApiKey)
                  message.success('已复制到剪贴板')
                }}
                className="mt-1 !px-0 !text-xs"
              >
                复制
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
