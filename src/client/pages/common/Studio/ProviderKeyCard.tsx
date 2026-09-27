import { ApiOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Input, Space, Tag, message } from 'antd'
import { useState } from 'react'
import { t, useAppLanguage } from '../../../i18n'

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
  useAppLanguage()

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
      message.error(error instanceof Error ? t(error.message) : t('操作失败'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="studio-provider-key-card">
      <div className="studio-provider-key-title">
        <span>{provider} API Key</span>
        <Tag color={configured ? 'success' : 'default'}>
          {configured ? t('已设置 {0}', [keyHint || '']) : t('未设置')}
        </Tag>
      </div>
      <Input.Password
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={
          configured
            ? t('留空则继续使用现有 Key')
            : t('输入 {0} API Key', [provider])
        }
        autoComplete="new-password"
        onPressEnter={() => {
          if (apiKey.trim())
            void run('save', async () => {
              await onSave(apiKey.trim())
              window.dispatchEvent(
                new CustomEvent('studio-balance-changed', {
                  detail: provider.toLowerCase(),
                }),
              )
              setApiKey('')
              message.success(t('{0} API Key 已保存', [provider]))
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
              window.dispatchEvent(
                new CustomEvent('studio-balance-changed', {
                  detail: provider.toLowerCase(),
                }),
              )
              setApiKey('')
              message.success(t('{0} API Key 已保存', [provider]))
            })
          }
        >
          {t('保存 Key')}
        </Button>
        <Button
          icon={<ApiOutlined />}
          loading={busy === 'test'}
          disabled={!configured || busy !== null}
          onClick={() =>
            void run('test', async () => {
              const detail = await onTest()
              message.success(
                detail
                  ? t('{0} 已连接：{1}', [provider, detail])
                  : t('{0} 已连接', [provider]),
              )
            })
          }
        >
          {t('测试连接')}
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
                message.success(t('{0} API Key 已清除', [provider]))
              })
            }
          >
            {t('清除')}
          </Button>
        )}
      </Space>
      <small>{t('Key 只保存于服务端工作室配置，不会随页面接口返回。')}</small>
    </div>
  )
}
