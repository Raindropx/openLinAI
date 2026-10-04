import {
  BgColorsOutlined,
  DeleteOutlined,
  ExperimentOutlined,
} from '@ant-design/icons'
import { Button, Checkbox, Form, Input, InputNumber, Select } from 'antd'
import classnames from 'classnames'
import React, { useEffect, useState } from 'react'
import { useLocalSetting } from '../../../../hooks/useLocalSetting'
import { t, useAppLanguage } from '../../../../i18n'
import { useGlobalStore } from '../../../../store/global'
import { FolderFormItem } from './FolderSelectInput'
import { ImageUpload } from './ImageUpload'
import { StyleExtractModal } from './StyleExtractModal'
import { StylePresetModal } from './StylePresetModal'

function EndpointSelectFormItem({
  className,
  syncSelectedEndpoint,
}: {
  className?: string
  syncSelectedEndpoint: boolean
}) {
  useAppLanguage()

  const endpoints = useGlobalStore((state) => state.endpoints)
  const { setGptImageSettings } = useLocalSetting()

  return (
    <Form.Item
      name="endpointId"
      label={t('生成端点')}
      className={className}
      rules={[{ required: true, message: t('请先在设置中添加端点') }]}
    >
      <Select
        onChange={(id) => {
          if (syncSelectedEndpoint) {
            setGptImageSettings((prev) => ({
              ...prev,
              selectedEndpointId: id,
            }))
          }
        }}
        placeholder={t('请先在设置中添加端点')}
        options={endpoints.map((e) => ({
          value: e.id,
          label: e.name || t('未命名端点'),
        }))}
        notFoundContent={t('未配置端点，请到设置中添加')}
      />
    </Form.Item>
  )
}

function shouldEnableGpt2QualityOptimization(model: string | undefined) {
  const normalizedModel = model?.toLowerCase()
  return [
    'gpt-image-2',
    'gpt-5.4-image',
    'openai/gpt-image-2',
    'openai/gpt-5.4-image',
  ].some((prefix) => normalizedModel?.startsWith(prefix))
}

function TitleFormItem({ className }: { className?: string }) {
  useAppLanguage()

  return (
    <Form.Item name="title" label={t('标题')} className={className}>
      <Input placeholder={t('请输入模板标题...')} />
    </Form.Item>
  )
}

function AspectRatioFormItem({ className }: { className?: string }) {
  useAppLanguage()

  return (
    <Form.Item
      name="aspectRatio"
      label={t('比例')}
      className={className}
      rules={[{ required: true, message: t('请选择比例') }]}
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
  )
}

function PromptOptionsFormItem({ className }: { className?: string }) {
  useAppLanguage()

  return (
    <div
      className={classnames(className, 'flex min-w-0 flex-wrap gap-x-3 gap-y-1')}
    >
      <Form.Item name="injectAspectRatio" valuePropName="checked" noStyle>
        <Checkbox className="m-0! min-w-0 max-w-full whitespace-normal">
          {t('比例注入提示词')}
        </Checkbox>
      </Form.Item>
      <Form.Item name="gpt2QualityOptimization" valuePropName="checked" noStyle>
        <Checkbox className="m-0! min-w-0 max-w-full whitespace-normal">
          {t('GPT-I2画面优化')}
        </Checkbox>
      </Form.Item>
    </div>
  )
}

function CountFormItem({ className }: { className?: string }) {
  useAppLanguage()

  return (
    <Form.Item
      name="n"
      label={t('张数')}
      className={classnames(className, '[&_.ant-input-number]:w-full!')}
    >
      <InputNumber min={1} max={8} className="" />
    </Form.Item>
  )
}

function PromptFormItem({
  className,
  label = t('提示词'),
  optimizeButton,
  form,
}: {
  className?: string
  label?: React.ReactNode
  optimizeButton?: React.ReactNode
  form: any
}) {
  useAppLanguage()

  const [styleExtractOpen, setStyleExtractOpen] = useState(false)
  const [stylePresetOpen, setStylePresetOpen] = useState(false)

  return (
    <>
      <Form.Item
        name="prompt"
        label={
          <div className="flex w-full flex-col items-start gap-1">
            <span>{label}</span>
            <span className="grid w-full grid-cols-2 items-center gap-x-3 gap-y-1">
              <Button
                type="link"
                size="small"
                icon={<BgColorsOutlined />}
                className="px-0!"
                onClick={() => setStylePresetOpen(true)}
              >
                {t('风格预设')}
              </Button>
              <Button
                type="link"
                size="small"
                icon={<ExperimentOutlined />}
                className="px-0!"
                onClick={() => setStyleExtractOpen(true)}
              >
                {t('图片风格提取')}
              </Button>
              {optimizeButton}
              <Button
                type="link"
                size="small"
                icon={<DeleteOutlined />}
                className="px-0!"
                onClick={() => form.setFieldsValue({ prompt: '' })}
              >
                {t('清空')}
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
        rules={[{ required: true, message: t('请填写提示词') }]}
      >
        <Input.TextArea
          autoSize={{ minRows: 5, maxRows: 10 }}
          placeholder={t('请输入生成内容的提示词...')}
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
  syncSelectedEndpoint = false,
}: {
  form: any
  imageUrls: string[]
  setImageUrls: (urls: string[]) => void
  setUploadingCount: (count: number) => void
  optimizeButton?: React.ReactNode
  syncSelectedEndpoint?: boolean
}) {
  useAppLanguage()

  const { gptImageSettings } = useLocalSetting()
  const endpoints = useGlobalStore((state) => state.endpoints)
  const endpointId = Form.useWatch('endpointId', form)
  const selectedEndpoint = endpoints.find((endpoint) => endpoint.id === endpointId)

  useEffect(() => {
    if (!endpointId || !selectedEndpoint) return
    form.setFieldValue(
      'gpt2QualityOptimization',
      shouldEnableGpt2QualityOptimization(selectedEndpoint.model),
    )
  }, [endpointId, form, selectedEndpoint])

  return (
    <>
      <EndpointSelectFormItem
        className="w-full"
        syncSelectedEndpoint={syncSelectedEndpoint}
      />

      <div className="grid min-w-0 grid-cols-2 gap-x-3">
        <TitleFormItem className="col-span-2 min-w-0" />
        <FolderFormItem className="mb-2! min-w-0" />
        <AspectRatioFormItem className="mb-2! min-w-0" />
        <PromptOptionsFormItem className="col-span-2 mb-6" />
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <Form.Item label={t('上传图片')} className="min-w-0 flex-1">
          <ImageUpload
            value={imageUrls}
            onChange={setImageUrls}
            onUploadingChange={(isUploading) =>
              setUploadingCount(isUploading ? 1 : 0)
            }
            onFirstImageRatio={
              (gptImageSettings.autoSelectAspectRatioFromReference ?? true)
                ? (ratio) => {
                    form.setFieldsValue({ aspectRatio: ratio })
                  }
                : undefined
            }
          />
        </Form.Item>
        {gptImageSettings.enableMultiple && (
          <CountFormItem className="w-full" />
        )}
      </div>

      <PromptFormItem form={form} optimizeButton={optimizeButton} />
    </>
  )
}
