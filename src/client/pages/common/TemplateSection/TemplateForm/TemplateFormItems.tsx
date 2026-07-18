import {
  BgColorsOutlined,
  DeleteOutlined,
  ExperimentOutlined,
} from '@ant-design/icons'
import { Button, Checkbox, Form, Input, InputNumber, Select } from 'antd'
import classnames from 'classnames'
import React, { useState } from 'react'
import { useGlobalStore } from '../../../../store/global'
import { useLocalSetting } from '../../../../hooks/useLocalSetting'
import { FolderFormItem } from './FolderSelectInput'
import { ImageUpload } from './ImageUpload'
import { StyleExtractModal } from './StyleExtractModal'
import { StylePresetModal } from './StylePresetModal'

function EndpointSelectFormItem({ className }: { className?: string }) {
  const endpoints = useGlobalStore((state) => state.endpoints)
  const { gptImageSettings, setGptImageSettings } = useLocalSetting()
  const selectedId =
    gptImageSettings.selectedEndpointId || endpoints[0]?.id

  return (
    <Form.Item
      label="生成端点"
      className={className}
      rules={[{ required: true, message: '请先在设置中添加端点' }]}
    >
      <Select
        value={endpoints.length ? selectedId : undefined}
        onChange={(id) =>
          setGptImageSettings((prev) => ({ ...prev, selectedEndpointId: id }))
        }
        placeholder="请先在设置中添加端点"
        options={endpoints.map((e) => ({
          value: e.id,
          label: e.name || '未命名端点',
        }))}
        notFoundContent="未配置端点，请到设置中添加"
      />
    </Form.Item>
  )
}

function TitleFormItem({ className }: { className?: string }) {
  return (
    <Form.Item name="title" label="标题" className={className}>
      <Input placeholder="请输入模板标题..." />
    </Form.Item>
  )
}

function AspectRatioFormItem({ className }: { className?: string }) {
  return (
    <Form.Item
      label="比例"
      className={className}
      // 仅用于展示 label 与容纳下拉框 + 复选框，本身不绑定字段
      required
    >
      <div>
        <Form.Item
          name="aspectRatio"
          rules={[{ required: true, message: '请选择比例' }]}
          noStyle
        >
          <Select
            options={[
              { label: '21:9', value: '21:9' },
              { label: '2:1', value: '2:1' },
              { label: '16:9', value: '16:9' },
              { label: '3:2', value: '3:2' },
              { label: '4:3', value: '4:3' },
              { label: '1:1', value: '1:1' },
              { label: '3:4', value: '3:4' },
              { label: '2:3', value: '2:3' },
              { label: '9:16', value: '9:16' },
              { label: '1:2', value: '1:2' },
              { label: '9:21', value: '9:21' },
              { label: 'Auto', value: 'auto' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="injectAspectRatio"
          valuePropName="checked"
          noStyle
        >
          <Checkbox className="mt-1 whitespace-nowrap">注入提示</Checkbox>
        </Form.Item>
      </div>
    </Form.Item>
  )
}

function CountFormItem({ className }: { className?: string }) {
  return (
    <Form.Item
      name="n"
      label="张数"
      className={classnames(className, '[&_.ant-input-number]:w-full!')}
    >
      <InputNumber min={1} max={8} className="" />
    </Form.Item>
  )
}

function PromptFormItem({
  className,
  label = '提示词',
  optimizeButton,
  form,
}: {
  className?: string
  label?: React.ReactNode
  optimizeButton?: React.ReactNode
  form: any
}) {
  const [styleExtractOpen, setStyleExtractOpen] = useState(false)
  const [stylePresetOpen, setStylePresetOpen] = useState(false)

  return (
    <>
      <Form.Item
        name="prompt"
        label={
          <div className="flex w-full flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <span>{label}</span>
            <span className="grid grid-cols-2 items-center gap-x-4 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-3">
              <Button
                type="link"
                size="small"
                icon={<BgColorsOutlined />}
                className="px-0!"
                onClick={() => setStylePresetOpen(true)}
              >
                风格预设
              </Button>
              <Button
                type="link"
                size="small"
                icon={<ExperimentOutlined />}
                className="px-0!"
                onClick={() => setStyleExtractOpen(true)}
              >
                图片风格提取
              </Button>
              {optimizeButton}
              <Button
                type="link"
                size="small"
                icon={<DeleteOutlined />}
                className="px-0!"
                onClick={() => form.setFieldsValue({ prompt: '' })}
              >
                清空
              </Button>
            </span>
          </div>
        }
        className={classnames(
          className,
          '[&_.ant-form-item-label>label]:w-full',
          '[&_.ant-form-item-label>label]:max-w-full',
          '[&_.ant-form-item-label>label]:h-auto!',
        )}
        rules={[{ required: true, message: '请填写提示词' }]}
      >
        <Input.TextArea
          autoSize={{ minRows: 5, maxRows: 10 }}
          placeholder="请输入生成内容的提示词..."
          style={{ resize: 'none' }}
        />
      </Form.Item>
      <StylePresetModal
        open={stylePresetOpen}
        currentPrompt={form.getFieldValue('prompt') || ''}
        onClose={() => setStylePresetOpen(false)}
        onApply={(prompt) => {
          form.setFieldsValue({ prompt })
          setStylePresetOpen(false)
        }}
      />
      <StyleExtractModal
        open={styleExtractOpen}
        currentPrompt={form.getFieldValue('prompt') || ''}
        onClose={() => setStyleExtractOpen(false)}
        onApply={(prompt) => {
          form.setFieldsValue({ prompt })
          setStyleExtractOpen(false)
        }}
      />
    </>
  )
}

export function TemplateFormFields({
  form,
  imageUrls,
  setImageUrls,
  setUploadingCount,
  optimizeButton,
}: {
  form: any
  imageUrls: string[]
  setImageUrls: (urls: string[]) => void
  setUploadingCount: (count: number) => void
  optimizeButton?: React.ReactNode
}) {
  const { gptImageSettings } = useLocalSetting()

  return (
    <>
      <EndpointSelectFormItem className="w-full" />

      <div className="grid min-w-0 grid-cols-2 gap-x-3 sm:flex sm:gap-4">
        <TitleFormItem className="col-span-2 min-w-0 sm:flex-1" />
        <FolderFormItem className="min-w-0 sm:w-1/4" />
        <AspectRatioFormItem className="min-w-0 sm:w-1/5" />
      </div>

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:gap-4">
        <Form.Item label="上传图片" className="min-w-0 flex-1">
          <ImageUpload
            value={imageUrls}
            onChange={setImageUrls}
            onUploadingChange={(isUploading) =>
              setUploadingCount(isUploading ? 1 : 0)
            }
            onFirstImageRatio={(ratio) => {
              form.setFieldsValue({ aspectRatio: ratio })
            }}
          />
        </Form.Item>
        {gptImageSettings.enableMultiple && (
          <CountFormItem className="w-full sm:w-1/5" />
        )}
      </div>

      <PromptFormItem form={form} optimizeButton={optimizeButton} />
    </>
  )
}
