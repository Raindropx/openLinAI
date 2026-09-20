import { ApiOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Input, Space, Tag, message } from 'antd'
import { useState } from 'react'

export function ProviderKeyCard({
  provider,
  configured,
  keyHint,
  onSave,
  onClear,
  onTest,
}: {
  provider: 'NovelAI' | 'Civitai'
  configured: boolean
  keyHint?: string
  onSave: (apiKey: string) => Promise<void>
  onClear: () => Promise<void>
  onTest: () => Promise<string | undefined>
}) {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'clear' | 'test' | null>(null)

  async function run(
    kind: 'save' | 'clear' | 'test',
    operation: () => Promise<void>,
  ) {
    setBusy(kind)
    try {
      await operation()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="studio-provider-key-card">
      <div className="studio-provider-key-title">
        <span>{provider} API Key</span>
        <Tag color={configured ? 'success' : 'default'}>
          {configured ? `已设置 ${keyHint || ''}` : '未设置'}
        </Tag>
      </div>
      <Input.Password
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={
          configured ? '留空则继续使用现有 Key' : `输入 ${provider} API Key`
        }
        autoComplete="new-password"
        onPressEnter={() => {
          if (apiKey.trim())
            void run('save', async () => {
              await onSave(apiKey.trim())
              setApiKey('')
              message.success(`${provider} API Key 已保存`)
            })
        }}
      />
      <Space wrap>
        <Button
          icon={<SaveOutlined />}
          loading={busy === 'save'}
          disabled={!apiKey.trim() || busy !== null}
          onClick={() =>
            void run('save', async () => {
              await onSave(apiKey.trim())
              setApiKey('')
              message.success(`${provider} API Key 已保存`)
            })
          }
        >
          保存 Key
        </Button>
        <Button
          icon={<ApiOutlined />}
          loading={busy === 'test'}
          disabled={!configured || busy !== null}
          onClick={() =>
            void run('test', async () => {
              const detail = await onTest()
              message.success(
                detail ? `${provider} 已连接：${detail}` : `${provider} 已连接`,
              )
            })
          }
        >
          测试连接
        </Button>
        {configured && (
          <Button
            danger
            type="text"
            icon={<DeleteOutlined />}
            loading={busy === 'clear'}
            disabled={busy !== null}
            onClick={() =>
              void run('clear', async () => {
                await onClear()
                message.success(`${provider} API Key 已清除`)
              })
            }
          >
            清除
          </Button>
        )}
      </Space>
      <small>Key 只保存于服务端工作室配置，不会随页面接口返回。</small>
    </div>
  )
}
