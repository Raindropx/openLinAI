import {
  BulbOutlined,
  FileAddOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { Button, Form, message } from 'antd'
import { hc } from 'hono/client'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { AppType } from '../../../../../server'
import type { TaskTemplate } from '../../../../../server/common/template-manager'
import type { GptImageSize } from '../../../../../server/module/gpt-image/enum'
import {
  requestChatCompletion,
  type ChatMessage,
} from '../../../../hooks/useChatCompletion'
import { useLocalSetting } from '../../../../hooks/useLocalSetting'
import { useGlobalStore } from '../../../../store/global'
import { openSettingModal } from '../../SettingModal'
import { PromptOptimizeModal } from './PromptOptimizeModal'
import { TemplateFormFields } from './TemplateFormItems'

const client = hc<AppType>('/')

interface TemplateFormProps {
  onSuccess: () => void
  showHeading?: boolean
  editorMode?: boolean
  activeTemplateId?: string | null
  onTemplateLoaded?: (template: Partial<TaskTemplate>) => void
  onEditingTemplateChange?: (template: TaskTemplate | null) => void
}

export function TemplateForm({
  onSuccess,
  showHeading = true,
  editorMode = false,
  activeTemplateId = null,
  onTemplateLoaded,
  onEditingTemplateChange,
}: TemplateFormProps) {
  const formRef = useRef<HTMLDivElement>(null)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [dirty, setDirty] = useState(false)
  const saveIntentRef = useRef<'save' | 'save-as'>('save-as')
  const {
    endpoints,
    llmEndpoints,
    llmPrompts,
    fillTemplateData,
    setFillTemplateData,
    pendingReferenceImage,
    clearPendingReferenceImage,
    setFocusNewestTask,
  } = useGlobalStore(
    useShallow((state) => ({
      endpoints: state.endpoints,
      llmEndpoints: state.llmEndpoints,
      llmPrompts: state.llmPrompts,
      fillTemplateData: state.fillTemplateData,
      setFillTemplateData: state.setFillTemplateData,
      pendingReferenceImage: state.pendingReferenceImage,
      clearPendingReferenceImage: state.clearPendingReferenceImage,
      setFocusNewestTask: state.setFocusNewestTask,
    })),
  )
  const {
    gptImageSettings,
    optimizeEndpointId,
    setGptImageSettings,
    setOptimizeEndpointId,
  } = useLocalSetting()
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
        endpointId:
          fillTemplateData.endpointId ||
          gptImageSettings.selectedEndpointId ||
          endpoints[0]?.id,
        aspectRatio: fillTemplateData.aspectRatio || '1:1',
        injectAspectRatio: fillTemplateData.injectAspectRatio ?? false,
        n: fillTemplateData.n || 1,
        prompt: fillTemplateData.prompt,
        usageType: fillTemplateData.usageType || 'image',
      })
      setImageUrls(fillTemplateData.images || [])
      onTemplateLoaded?.(fillTemplateData)
      if (fillTemplateData.endpointId) {
        setGptImageSettings((prev) => ({
          ...prev,
          selectedEndpointId: fillTemplateData.endpointId,
        }))
      }
      setFillTemplateData(null)
      setDirty(false)

      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [
    endpoints,
    fillTemplateData,
    form,
    gptImageSettings.selectedEndpointId,
    setFillTemplateData,
    setGptImageSettings,
    onTemplateLoaded,
  ])

  useEffect(() => {
    if (!pendingReferenceImage) return

    setImageUrls((currentUrls) =>
      currentUrls.includes(pendingReferenceImage.url)
        ? currentUrls
        : [...currentUrls, pendingReferenceImage.url],
    )
    setDirty(true)
    clearPendingReferenceImage()
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [clearPendingReferenceImage, pendingReferenceImage])

  useEffect(() => {
    if (!form.getFieldValue('endpointId')) {
      form.setFieldValue(
        'endpointId',
        gptImageSettings.selectedEndpointId || endpoints[0]?.id,
      )
    }
  }, [endpoints, form, gptImageSettings.selectedEndpointId])

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
      form.getFieldValue('endpointId') ||
      gptImageSettings.selectedEndpointId ||
      endpoints[0]?.id

    message.success('任务提交成功')
    // 提交即让任务列表与画布自动聚焦到最新任务，无需等待生成成功
    setFocusNewestTask()
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
          writeMetadata: gptImageSettings.writeGenerationMetadata ?? true,
        },
      })

      const data = await res.json()

      if (!data.success) {
        message.error(data.error || '生成失败')
      } else {
        // 提交成功后让任务列表与画布自动聚焦到最新任务
        setFocusNewestTask()
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
    setDirty(true)
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
      const shouldUpdate =
        editorMode &&
        saveIntentRef.current === 'save' &&
        Boolean(activeTemplateId)
      const res = shouldUpdate
        ? await client.api.template[':id'].$put({
            param: { id: activeTemplateId! },
            json: {
              title: payload.title,
              endpointId: payload.endpointId,
              prompt: payload.prompt,
              aspectRatio: payload.aspectRatio,
              injectAspectRatio: payload.injectAspectRatio,
              folder: payload.folder,
              images: payload.images,
              n: payload.n,
            },
          })
        : await client.api.template.$post({ json: payload })
      const json = await res.json()

      if (json.success) {
        message.success(shouldUpdate ? '模板已更新' : '已另存为新模板')
        setDirty(false)
        if (editorMode) {
          onEditingTemplateChange?.(json.data as TaskTemplate)
        } else {
          form.resetFields()
          form.setFieldValue(
            'endpointId',
            gptImageSettings.selectedEndpointId || endpoints[0]?.id,
          )
          setImageUrls([])
        }
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

  const handleNewTemplate = () => {
    form.resetFields()
    form.setFieldsValue({
      usageType: 'image',
      endpointId: gptImageSettings.selectedEndpointId || endpoints[0]?.id,
      aspectRatio: '1:1',
      injectAspectRatio: false,
      n: 1,
    })
    setImageUrls([])
    setDirty(false)
    onEditingTemplateChange?.(null)
    message.success('已新建空白模板草稿')
  }

  const promptValue = Form.useWatch('prompt', form) || ''

  return (
    <>
      {showHeading && (
        <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-100">
          <PlusOutlined className="app-accent-text" /> 新增模板
        </h3>
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{
          usageType: 'image',
          endpointId: gptImageSettings.selectedEndpointId || endpoints[0]?.id,
          aspectRatio: '1:1',
          n: 1,
        }}
        onValuesChange={() => setDirty(true)}
      >
        <div ref={formRef} />
        {/* usageType 固定为 image（引擎由端点决定，无需在表单区分） */}
        <Form.Item name="usageType" hidden>
          <input />
        </Form.Item>

        <TemplateFormFields
          form={form}
          imageUrls={imageUrls}
          setImageUrls={(urls) => {
            setImageUrls(urls)
            setDirty(true)
          }}
          setUploadingCount={setUploadingCount}
          syncSelectedEndpoint
          optimizeButton={
            <Button
              size="small"
              type="link"
              icon={<BulbOutlined />}
              className="h-auto! px-0!"
              onClick={handlePromptOptimize}
            >
              提示词优化
            </Button>
          }
        />

        <Form.Item className="mb-0! pt-4">
          {editorMode ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {activeTemplateId ? '正在编辑已保存模板' : '新模板草稿'}
                  <span className="mx-2 text-slate-700">·</span>
                  提示词 {String(promptValue).length} 字
                  <span className="mx-2 text-slate-700">·</span>
                  参考图 {imageUrls.length} 张
                </span>
                <span className={dirty ? 'text-amber-300' : 'text-emerald-400'}>
                  {dirty ? '有未保存修改' : '已保存'}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-[auto_1fr_1fr]">
                <Button
                  icon={<PlusOutlined />}
                  onClick={handleNewTemplate}
                  disabled={submitting}
                >
                  新建空白
                </Button>
                <Button
                  icon={<SaveOutlined />}
                  htmlType="submit"
                  loading={submitting && saveIntentRef.current === 'save'}
                  disabled={uploadingCount > 0 || !activeTemplateId}
                  onClick={() => {
                    saveIntentRef.current = 'save'
                  }}
                >
                  保存当前模板
                </Button>
                <Button
                  type="primary"
                  icon={<FileAddOutlined />}
                  htmlType="submit"
                  loading={submitting && saveIntentRef.current === 'save-as'}
                  disabled={uploadingCount > 0}
                  onClick={() => {
                    saveIntentRef.current = 'save-as'
                  }}
                >
                  另存为新模板
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 [&>:last-child:nth-child(odd)]:col-span-2">
              {gptImageSettings.enable1K && (
                <Button
                  onClick={() => handleTrial('1k')}
                  disabled={uploadingCount > 0}
                  size="large"
                  className="app-accent-outline grow"
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
                className="col-span-2 grow"
                size="large"
              >
                保存模板
              </Button>
            </div>
          )}
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
