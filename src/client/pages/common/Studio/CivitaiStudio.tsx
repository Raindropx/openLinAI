import { LinkOutlined, SearchOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Select,
  Switch,
  Tag,
  message,
} from 'antd'
import { useState } from 'react'
import type {
  CivitaiModelSearchResult,
  StudioProviderSettings,
} from '../../../../shared/studio-generation'
import {
  searchCivitaiModels,
  testStudioProvider,
  updateCivitaiSettings,
} from './api'
import { ProviderKeyCard } from './ProviderKeyCard'

interface SearchValues {
  query?: string
  type?: string
  baseModel?: string
  sort: string
  favorites: boolean
}

export function CivitaiStudio({
  settings,
  onSettings,
}: {
  settings: StudioProviderSettings['civitai']
  onSettings: (settings: StudioProviderSettings) => void
}) {
  const [form] = Form.useForm<SearchValues>()
  const [result, setResult] = useState<CivitaiModelSearchResult>({ items: [] })
  const [loading, setLoading] = useState(false)

  async function search(cursor?: string, append = false) {
    if (!settings.configured) {
      message.warning('请先保存 Civitai API Key')
      return
    }
    const values = await form.validateFields()
    setLoading(true)
    try {
      const next = await searchCivitaiModels({
        ...values,
        cursor,
        limit: 20,
      })
      setResult((current) => ({
        items: append ? [...current.items, ...next.items] : next.items,
        nextCursor: next.nextCursor,
      }))
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Civitai 搜索失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="studio-provider-panel">
      <ProviderKeyCard
        provider="Civitai"
        configured={settings.configured}
        keyHint={settings.keyHint}
        onSave={async (apiKey) =>
          onSettings(await updateCivitaiSettings({ apiKey }))
        }
        onClear={async () =>
          onSettings(await updateCivitaiSettings({ clearApiKey: true }))
        }
        onTest={async () => {
          const result = await testStudioProvider('civitai')
          return result.username
        }}
      />
      <Alert
        showIcon
        type="info"
        title="首阶段先接通 Civitai 模型目录"
        description="这里使用 Civitai Site API 搜索可在线生成的模型与 LoRA。下一阶段会接 Orchestration 工作流、Buzz 预估、LoRA 挂载和任务轮询。"
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ sort: 'Highest Rated', favorites: false }}
        className="studio-civitai-search"
      >
        <div className="studio-form-grid studio-form-grid-search">
          <Form.Item label="搜索" name="query">
            <Input placeholder="模型、LoRA 或作者关键词" allowClear />
          </Form.Item>
          <Form.Item label="类型" name="type">
            <Select
              allowClear
              placeholder="全部类型"
              options={[
                'Checkpoint',
                'LORA',
                'LoCon',
                'LyCORIS',
                'TextualInversion',
                'VAE',
                'Controlnet',
              ].map((value) => ({ label: value, value }))}
            />
          </Form.Item>
          <Form.Item label="基础模型" name="baseModel">
            <Input placeholder="例如 Illustrious、SDXL 1.0" allowClear />
          </Form.Item>
          <Form.Item label="排序" name="sort">
            <Select
              options={['Highest Rated', 'Most Downloaded', 'Newest'].map(
                (value) => ({ label: value, value }),
              )}
            />
          </Form.Item>
        </div>
        <div className="studio-search-actions">
          <Form.Item name="favorites" valuePropName="checked" noStyle>
            <Switch checkedChildren="仅收藏" unCheckedChildren="全部模型" />
          </Form.Item>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={loading}
            disabled={!settings.configured}
            onClick={() => void search()}
          >
            搜索模型
          </Button>
        </div>
      </Form>
      {!result.items.length ? (
        <Empty description="设置 Key 后搜索可在线生成的 Checkpoint 与 LoRA" />
      ) : (
        <div className="studio-model-grid">
          {result.items.map((model) => (
            <Card
              key={model.id}
              size="small"
              className="studio-model-card"
              cover={
                model.imageUrl ? (
                  <img
                    src={model.imageUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : undefined
              }
              actions={[
                <a
                  key="open"
                  href={`https://civitai.com/models/${model.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <LinkOutlined /> 查看 Civitai
                </a>,
              ]}
            >
              <Card.Meta
                title={model.name}
                description={model.creator ? `@${model.creator}` : '未知作者'}
              />
              <div className="studio-model-tags">
                <Tag>{model.type}</Tag>
                {model.nsfw && <Tag color="warning">Mature</Tag>}
              </div>
              <div className="studio-model-versions">
                {model.versions.slice(0, 4).map((version) => (
                  <div key={version.id}>
                    <strong>{version.name}</strong>
                    <span>{version.baseModel}</span>
                    {version.trainedWords.length > 0 && (
                      <small title={version.trainedWords.join(', ')}>
                        触发词：{version.trainedWords.slice(0, 3).join(', ')}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      {result.nextCursor && (
        <Button
          block
          loading={loading}
          onClick={() => void search(result.nextCursor, true)}
        >
          加载更多
        </Button>
      )}
    </div>
  )
}
