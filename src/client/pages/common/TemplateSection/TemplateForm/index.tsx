import { BulbOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Form, message } from 'antd'
import { hc } from 'hono/client'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { AppType } from '../../../../../server'
import type { GptImageSize } from '../../../../../server/module/gpt-image/enum'
import {
  requestChatCompletion,
  type ChatMessage,
} from '../../../../hooks/useChatCompletion'
import { useLocalSetting } from '../../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../../store/global'
import { openSettingModal } from '../../SettingModal'
import { TemplateFormFields } from './TemplateFormItems'
import { PromptOptimizeModal } from './PromptOptimizeModal'

const client = hc<AppType>('/')

interface TemplateFormProps {
  onSuccess: () => void
}

export function TemplateForm({ onSuccess }: TemplateFormProps) {
  const formRef = useRef<HTMLDivElement>(null)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const { endpoints, llmEndpoints, llmPrompts, fillTemplateData, setFillTemplateData } =
    useGlobalStore(
      useShallow((state) => ({
        endpoints: state.endpoints,
        llmEndpoints: state.llmEndpoints,
        llmPrompts: state.llmPrompts,
        fillTemplateData: state.fillTemplateData,
        setFillTemplateData: state.setFillTemplateData,
      })),
    )
  const { gptImageSettings, optimizeEndpointId, setOptimizeEndpointId } =
    useLocalSetting()
  // 提示词优化弹框状态
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [optimizeLoading, setOptimizeLoading] = useState(false)
  const [optimizeText, setOptimizeText] = useState('')

  // 触发填入模板数据
  useEffect(() => {
    if (fillTemplateData) {
      form.setFieldsValue({
        title: fillTemplateData.title,
        folder: fillTemplateData.folder,
        aspectRatio: fillTemplateData.aspectRatio,
        injectAspectRatio: fillTemplateData.injectAspectRatio,
        n: fillTemplateData.n,
        prompt: fillTemplateData.prompt,
        usageType: fillTemplateData.usageType || 'image',
      })
      if (fillTemplateData.images) {
        setImageUrls(fillTemplateData.images)
      }
      setFillTemplateData(null)

      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [fillTemplateData, form])

  const doTrial = async (size: GptImageSize) => {
    const prompt = form.getFieldValue('prompt')
    const n = form.getFieldValue('n') || 1
    if (!prompt) {
      message.warning('请先填写提示词')
      return
    }
    const aspectRatio = form.getFieldValue('aspectRatio') || '1:1'
    const injectAspectRatio = form.getFieldValue('injectAspectRatio') || false
    const endpointId =
      gptImageSettings.selectedEndpointId || endpoints[0]?.id

    message.success('任务提交成功')
    try {
      const res = await client.api.gptImage.trial.$post({
        json: {
          prompt,
          endpointId,
          aspectRatio,
          injectAspectRatio,
          images: imageUrls,
          size,
          quality: gptImageSettings.quality,
          n,
        },
      })

      const data = await res.json()

      if (!data.success) {
        message.error(data.error || '生成失败')
      }
    } catch (error) {
      message.error('请求失败')
    }
  }

  const handleTrial = (size: GptImageSize) => {
    const prompt = form.getFieldValue('prompt')
    if (!prompt) {
      message.warning('请先填写提示词')
      return
    }

    if (endpoints.length === 0) {
      openSettingModal({
        initialTab: 'gpt-image',
        onSuccess: () => {
          doTrial(size)
        },
      })
      return
    }

    doTrial(size)
  }

  // —— 提示词优化 ——
  const handlePromptOptimize = async () => {
    const prompt = form.getFieldValue('prompt') as string | undefined
    if (!prompt && imageUrls.length === 0) {
      message.warning('请先填写提示词或上传图片')
      return
    }

    const endpointId = optimizeEndpointId || llmEndpoints[0]?.id
    if (!endpointId) {
      openSettingModal({ initialTab: 'llm-endpoints' })
      return
    }
    if (!optimizeEndpointId) {
      setOptimizeEndpointId(endpointId)
    }

    setOptimizeOpen(true)
    setOptimizeLoading(true)
    setOptimizeText('')
    try {
      const content: any[] = []
      // 系统提示词
      const messages: ChatMessage[] = [
        { role: 'system', content: llmPrompts.optimizePrompt },
      ]
      // 用户消息：文本 + 图片
      if (prompt) content.push({ type: 'text', text: prompt })
      for (const url of imageUrls) {
        content.push({ type: 'image_url', image_url: { url } })
      }
      if (content.length > 0) {
        messages.push({ role: 'user', content: content as any })
      }
      const result = await requestChatCompletion({ endpointId, messages })
      setOptimizeText(result || '（优化结果为空）')
    } catch (error: any) {
      message.error(error.message || '提示词优化失败')
      setOptimizeOpen(false)
    } finally {
      setOptimizeLoading(false)
    }
  }

  const handleAdoptOptimize = (text: string) => {
    form.setFieldsValue({ prompt: text })
    setOptimizeOpen(false)
    message.success('已采纳优化后的提示词')
  }

  const handleFinish = async (values: any) => {
    setSubmitting(true)
    try {
      const payload = {
        ...values,
        images: imageUrls,
      }

      const res = await client.api.template.$post({ json: payload })
      const json = await res.json()

      if (json.success) {
        message.success('保存成功')
        form.resetFields()
        setImageUrls([])
        onSuccess()
      } else {
        message.error(json.error || '保存失败')
      }
    } catch (error) {
      message.error('请求失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
        <PlusOutlined className="text-emerald-500" /> 新增模板
      </h3>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{
          usageType: 'image',
          aspectRatio: '1:1',
          n: 1,
        }}
      >
        <div ref={formRef} />
        {/* usageType 固定为 image（引擎由端点决定，无需在表单区分） */}
        <Form.Item name="usageType" hidden initialValue="image">
          <input />
        </Form.Item>

        <TemplateFormFields
          form={form}
          imageUrls={imageUrls}
          setImageUrls={setImageUrls}
          setUploadingCount={setUploadingCount}
          optimizeButton={
            <Button
              size="small"
              type="link"
              icon={<BulbOutlined />}
              className="h-auto! px-1! text-xs"
              onClick={handlePromptOptimize}
            >
              提示词优化
            </Button>
          }
        />

        <Form.Item className="mb-0! border-t border-slate-100 pt-4">
          <div className="flex gap-4">
            {gptImageSettings.enable1K && (
              <Button
                onClick={() => handleTrial('1k')}
                disabled={uploadingCount > 0}
                size="large"
                className="grow border-purple-300 text-purple-600 hover:border-purple-400 hover:text-purple-500"
              >
                生成1K图
              </Button>
            )}
            {gptImageSettings.enable2K && (
              <Button
                onClick={() => handleTrial('2k')}
                disabled={uploadingCount > 0}
                size="large"
                className="grow"
              >
                生成2K图
              </Button>
            )}
            {gptImageSettings.enable4K && (
              <Button
                onClick={() => handleTrial('4k')}
                disabled={uploadingCount > 0}
                size="large"
                className="grow"
              >
                生成4K图
              </Button>
            )}
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              disabled={uploadingCount > 0}
              className="grow"
              size="large"
            >
              保存模板
            </Button>
          </div>
        </Form.Item>
      </Form>
      <PromptOptimizeModal
        open={optimizeOpen}
        loading={optimizeLoading}
        initialText={optimizeText}
        onCancel={() => setOptimizeOpen(false)}
        onAdopt={handleAdoptOptimize}
      />
    </>
  )
}
