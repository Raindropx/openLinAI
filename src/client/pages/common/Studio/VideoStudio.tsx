import {
  Alert,
  Button,
  Form,
  Image,
  Input,
  message,
  Select,
  Space,
  Upload,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import { studioFileUrl, type StudioItem } from '../../../../shared/studio'
import {
  videoModeLabel,
  type VideoCapabilities,
  type VideoReference,
  type VideoRequest,
} from '../../../../shared/video'
import { useTasks } from '../../../hooks/useTasks'
import { t, useAppLanguage } from '../../../i18n'
import { imageBlobToUploadDataUrl } from '../../../utils/image'
import {
  uploadInputImageBase64,
  uploadInputImageFromUrl,
} from '../../../utils/uploadInputImage'
import { openGallery } from '../components/Gallery'
import { studioJson, studioRequest } from './api'
import { VideoTaskCard } from './VideoTaskCard'

export function VideoStudio({
  items,
  incomingReference,
}: {
  items: StudioItem[]
  incomingReference?: { id: number; url: string }
}) {
  useAppLanguage()
  const [caps, setCaps] = useState<VideoCapabilities[]>([])
  const [loadingCapabilities, setLoadingCapabilities] = useState(true)
  const [capabilityAttempt, setCapabilityAttempt] = useState(0)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reference, setReference] = useState('')
  const [lastReference, setLastReference] = useState('')
  const [frameSlot, setFrameSlot] = useState<'first' | 'last'>('first')
  const [references, setReferences] = useState<VideoReference[]>([])
  const [mediaType, setMediaType] = useState<'video' | 'audio'>('video')
  const [mediaUrl, setMediaUrl] = useState('')
  const [form] = Form.useForm<VideoRequest>()
  const providerId = Form.useWatch('provider', form)
  const generationType = Form.useWatch('generationType', form)
  const frameMode = Form.useWatch('frameMode', form)
  const provider = caps.find((entry) => entry.provider === providerId)
  const tasks = useTasks()
  const consumedReference = useRef<number | undefined>(undefined)
  const uploadPending = useRef(false)
  const submitPending = useRef(false)
  const referenceLimitReached = (type: VideoReference['type']) => {
    const limits = provider?.references
    const max =
      limits &&
      (type === 'image'
        ? limits.maxImages
        : type === 'video'
          ? limits.maxVideos
          : limits.maxAudio)
    return (
      !limits ||
      references.length >= limits.maxTotalFiles ||
      references.filter((ref) => ref.type === type).length >= (max ?? 0)
    )
  }
  const invalidReferences =
    generationType === 'reference_to_video' &&
    (!provider?.references ||
      references.length > provider.references.maxTotalFiles ||
      references.filter((ref) => ref.type === 'image').length >
        provider.references.maxImages ||
      references.filter((ref) => ref.type === 'video').length >
        provider.references.maxVideos ||
      references.filter((ref) => ref.type === 'audio').length >
        provider.references.maxAudio)

  useEffect(() => {
    let cancelled = false
    setLoadingCapabilities(true)
    setError('')
    studioRequest<VideoCapabilities[]>('/videos/capabilities')
      .then((data) => {
        if (cancelled) return
        setCaps(data)
        if (data[0]) form.setFieldValue('provider', data[0].provider)
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingCapabilities(false)
      })
    return () => {
      cancelled = true
    }
  }, [form, capabilityAttempt])
  useEffect(() => {
    if (!provider) return
    form.setFieldsValue({
      model: provider.models[0],
      generationType: provider.generationTypes[0],
      durationSeconds: provider.durations[0],
      resolution: provider.resolutions[0],
      aspectRatio: provider.aspectRatios[0],
      frameMode: provider.frameModes?.[0] || 'first_frame',
    })
    setMediaType(provider.references?.maxVideos ? 'video' : 'audio')
  }, [provider, form])

  useEffect(() => {
    if (
      !incomingReference ||
      !provider ||
      consumedReference.current === incomingReference.id
    )
      return
    const currentMode = form.getFieldValue(
      'generationType',
    ) as VideoRequest['generationType']
    const mode =
      currentMode === 'text_to_video'
        ? provider.generationTypes.includes('reference_to_video')
          ? 'reference_to_video'
          : 'image_to_video'
        : currentMode
    if (!provider.generationTypes.includes(mode)) {
      consumedReference.current = incomingReference.id
      message.warning(t('当前服务商不支持图片输入'))
      return
    }
    if (mode === 'reference_to_video' && referenceLimitReached('image')) {
      consumedReference.current = incomingReference.id
      message.warning(t('参考素材数量已达上限，请先移除素材'))
      return
    }
    if (uploadPending.current) return
    consumedReference.current = incomingReference.id
    uploadPending.current = true
    form.setFieldValue('generationType', mode)
    setUploading(true)
    void uploadInputImageFromUrl(incomingReference.url)
      .then((url) => {
        if (mode === 'reference_to_video')
          setReferences((current) => [
            ...current,
            { type: 'image', imageUrl: url },
          ])
        else if (
          frameSlot === 'last' &&
          form.getFieldValue('frameMode') === 'first_last_frame'
        )
          setLastReference(url)
        else setReference(url)
      })
      .catch((cause: Error) => message.error(cause.message))
      .finally(() => {
        uploadPending.current = false
        setUploading(false)
      })
  }, [incomingReference, provider, form, frameSlot, uploading])

  async function stageReference(load: () => Promise<string>) {
    if (uploadPending.current) return
    if (
      generationType === 'reference_to_video' &&
      referenceLimitReached('image')
    ) {
      message.warning(t('参考素材数量已达上限，请先移除素材'))
      return
    }
    uploadPending.current = true
    setUploading(true)
    try {
      const url = await load()
      if (generationType === 'reference_to_video')
        setReferences((current) => [
          ...current,
          { type: 'image', imageUrl: url },
        ])
      else if (frameSlot === 'last' && frameMode === 'first_last_frame')
        setLastReference(url)
      else setReference(url)
    } catch (cause) {
      message.error((cause as Error).message)
    } finally {
      uploadPending.current = false
      setUploading(false)
    }
  }

  return (
    <div className="studio-video-content">
      <Alert
        type="info"
        showIcon
        title={t(
          '视频在云端生成；取回保存到服务端外接存储，下载保存到当前设备。',
        )}
      />
      {error && (
        <Alert
          type="error"
          title={error}
          action={
            <Button onClick={() => setCapabilityAttempt((value) => value + 1)}>
              {t('重试')}
            </Button>
          }
        />
      )}
      {loadingCapabilities && (
        <Alert type="info" title={t('正在加载视频服务商配置…')} />
      )}
      {!loadingCapabilities && !error && !caps.length && (
        <Alert
          type="warning"
          showIcon
          title={t('尚未配置视频服务商')}
          description={t(
            '需要真实服务商文档和凭证后接入。开发测试可设置 VIDEO_MOCK_RESULT_URL 与 VIDEO_ALLOWED_HOSTS 启用模拟任务。',
          )}
        />
      )}
      {provider?.mock && (
        <Alert
          type="warning"
          showIcon
          title={t(
            '当前为 Mock：仅模拟排队和完成，结果使用管理员配置的测试视频，不会根据提示词生成视频。',
          )}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        disabled={uploading || submitting || loadingCapabilities}
        onFinish={async (input) => {
          if (
            submitPending.current ||
            uploadPending.current ||
            invalidReferences ||
            !provider
          )
            return
          submitPending.current = true
          setSubmitting(true)
          try {
            const { frameMode: selectedFrames, ...common } = input
            await studioRequest(
              '/videos',
              studioJson('POST', {
                ...common,
                inputImages:
                  input.generationType === 'reference_to_video'
                    ? references.flatMap((ref) =>
                        ref.type === 'image' ? [ref.imageUrl] : [],
                      )
                    : input.generationType === 'image_to_video' && reference
                      ? [
                          reference,
                          ...(selectedFrames === 'first_last_frame'
                            ? [lastReference]
                            : []),
                        ]
                      : [],
                ...(input.generationType === 'image_to_video'
                  ? {
                      frameMode: selectedFrames || 'first_frame',
                      frames: {
                        firstImageUrl: reference,
                        ...(selectedFrames === 'first_last_frame'
                          ? { lastImageUrl: lastReference }
                          : {}),
                      },
                    }
                  : {}),
                ...(input.generationType === 'reference_to_video'
                  ? { references }
                  : {}),
              }),
            )
            tasks.refresh()
            message.success(t('视频任务已加入后台队列'))
          } catch (cause) {
            message.error((cause as Error).message)
          } finally {
            submitPending.current = false
            setSubmitting(false)
          }
        }}
      >
        <div className="studio-video-fields">
          <Form.Item
            name="provider"
            label={t('服务商')}
            rules={[{ required: true }]}
          >
            <Select
              options={caps.map((entry) => ({
                value: entry.provider,
                label: entry.label,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="model"
            label={t('模型')}
            rules={[{ required: true }]}
          >
            <Select
              options={provider?.models.map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="generationType"
            label={t('生成模式')}
            rules={[{ required: true }]}
          >
            <Select
              options={provider?.generationTypes.map((value) => ({
                value,
                label: t(videoModeLabel(value)),
              }))}
            />
          </Form.Item>
          {generationType === 'image_to_video' && (
            <Form.Item
              name="frameMode"
              label={t('关键帧模式')}
              rules={[{ required: true }]}
            >
              <Select
                options={(provider?.frameModes || ['first_frame']).map(
                  (value) => ({
                    value,
                    label: t(value === 'first_last_frame' ? '首尾帧' : '首帧'),
                  }),
                )}
              />
            </Form.Item>
          )}
          <Form.Item
            name="durationSeconds"
            label={t('时长（秒）')}
            rules={[{ required: true }]}
          >
            <Select
              options={provider?.durations.map((value) => ({
                value,
                label: String(value),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="resolution"
            label={t('分辨率')}
            rules={[{ required: true }]}
          >
            <Select
              options={provider?.resolutions.map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="aspectRatio"
            label={t('画面比例')}
            rules={[{ required: true }]}
          >
            <Select
              options={provider?.aspectRatios.map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
        </div>
        <Form.Item
          name="prompt"
          label={t('提示词')}
          rules={[{ required: true, whitespace: true }]}
        >
          <Input.TextArea
            rows={4}
            maxLength={provider?.maxPromptLength || 20000}
            showCount
          />
        </Form.Item>
        {(generationType === 'image_to_video' ||
          generationType === 'reference_to_video') && (
          <div style={{ marginBottom: 16 }}>
            {generationType === 'image_to_video' &&
              frameMode === 'first_last_frame' && (
                <div style={{ marginBottom: 8 }}>
                  <Select
                    value={frameSlot}
                    onChange={setFrameSlot}
                    style={{ width: 200 }}
                    options={[
                      { value: 'first', label: t('正在设置：首帧') },
                      { value: 'last', label: t('正在设置：尾帧') },
                    ]}
                  />
                  <span style={{ marginLeft: 8 }}>
                    {t('下方图库、上传和暂存台操作填入当前帧位')}
                  </span>
                </div>
              )}
            <Space wrap>
              <Button
                loading={uploading}
                disabled={
                  generationType === 'reference_to_video' &&
                  referenceLimitReached('image')
                }
                onClick={() =>
                  openGallery({
                    maxCount: 1,
                    onSelect: ([image]) => {
                      if (image)
                        void stageReference(() =>
                          uploadInputImageFromUrl(image.url),
                        )
                    },
                  })
                }
              >
                {t('从图库选图')}
              </Button>
              <Upload
                disabled={
                  uploading ||
                  (generationType === 'reference_to_video' &&
                    referenceLimitReached('image'))
                }
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                beforeUpload={(file) => {
                  if (file.size > 16 * 1024 * 1024) {
                    message.error(t('参考图不能超过 16 MiB'))
                    return false
                  }
                  void stageReference(async () =>
                    uploadInputImageBase64(
                      await imageBlobToUploadDataUrl(file),
                    ),
                  )
                  return false
                }}
              >
                <Button loading={uploading}>{t('上传参考图')}</Button>
              </Upload>
              <Select<string>
                placeholder={t('从暂存台选图')}
                style={{ minWidth: 180 }}
                value={undefined}
                disabled={
                  uploading ||
                  (generationType === 'reference_to_video' &&
                    referenceLimitReached('image'))
                }
                options={items
                  .filter((item) => item.format !== 'psd')
                  .map((item) => ({ value: item.id, label: item.name }))}
                onChange={(id) =>
                  void stageReference(() =>
                    uploadInputImageFromUrl(studioFileUrl(id)),
                  )
                }
              />
              {generationType === 'image_to_video' && (
                <Button
                  onClick={() => {
                    if (
                      frameSlot === 'last' &&
                      frameMode === 'first_last_frame'
                    )
                      setLastReference('')
                    else setReference('')
                  }}
                >
                  {t('清空当前帧')}
                </Button>
              )}
            </Space>
            {generationType === 'image_to_video' && (
              <Space style={{ marginTop: 8 }} align="start">
                <div>
                  <p>{t('首帧')}</p>
                  {reference ? (
                    <Image src={reference} width={140} />
                  ) : (
                    <span>{t('待选择')}</span>
                  )}
                </div>
                {frameMode === 'first_last_frame' && (
                  <div>
                    <p>{t('尾帧')}</p>
                    {lastReference ? (
                      <Image src={lastReference} width={140} />
                    ) : (
                      <span>{t('待选择')}</span>
                    )}
                  </div>
                )}
              </Space>
            )}
            {generationType === 'reference_to_video' && (
              <div style={{ marginTop: 12 }}>
                <p>{t('参考素材按列表顺序提交；参考图片不固定为首帧。')}</p>
                <small>
                  {t('数量上限（图片 / 视频 / 音频 / 总数）')}：
                  {provider?.references
                    ? `${provider.references.maxImages} / ${provider.references.maxVideos} / ${provider.references.maxAudio} / ${provider.references.maxTotalFiles}`
                    : '—'}
                </small>
                {invalidReferences && (
                  <Alert
                    type="warning"
                    title={t('参考素材超过当前模型上限，请移除多余素材')}
                    showIcon
                  />
                )}
                {provider?.references?.maxVideos ||
                provider?.references?.maxAudio ? (
                  <Space.Compact style={{ display: 'flex', marginTop: 8 }}>
                    <Select
                      value={mediaType}
                      onChange={setMediaType}
                      style={{ width: 110 }}
                      options={[
                        ...(provider?.references?.maxVideos
                          ? [{ value: 'video', label: t('参考视频') }]
                          : []),
                        ...(provider?.references?.maxAudio
                          ? [{ value: 'audio', label: t('参考音频') }]
                          : []),
                      ]}
                    />
                    <Input
                      value={mediaUrl}
                      onChange={(event) => setMediaUrl(event.target.value)}
                      placeholder={t('可公开访问的 HTTPS 素材链接')}
                    />
                    <Button
                      disabled={referenceLimitReached(mediaType)}
                      onClick={() => {
                        try {
                          const url = new URL(mediaUrl.trim())
                          if (
                            url.protocol !== 'https:' ||
                            url.username ||
                            url.password ||
                            url.hash ||
                            (url.port && url.port !== '443')
                          )
                            throw new Error()
                          setReferences((current) => [
                            ...current,
                            { type: mediaType, remoteUrl: mediaUrl.trim() },
                          ])
                          setMediaUrl('')
                        } catch {
                          message.error(t('请输入有效的 HTTPS 素材链接'))
                        }
                      }}
                    >
                      {t('添加')}
                    </Button>
                  </Space.Compact>
                ) : null}
                {references.map((ref, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <span>
                      {index + 1}.{' '}
                      {t(
                        ref.type === 'image'
                          ? '参考图片'
                          : ref.type === 'video'
                            ? '参考视频'
                            : '参考音频',
                      )}
                    </span>
                    {ref.type === 'image' ? (
                      <Image src={ref.imageUrl} width={60} />
                    ) : (
                      <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                        {new URL(ref.remoteUrl).hostname} ·{' '}
                        {new URL(ref.remoteUrl).pathname.split('/').pop() ||
                          t('已添加 HTTPS 素材')}
                      </span>
                    )}
                    <Button
                      size="small"
                      disabled={!index}
                      onClick={() =>
                        setReferences((current) => {
                          const next = [...current]
                          ;[next[index - 1], next[index]] = [
                            next[index],
                            next[index - 1],
                          ]
                          return next
                        })
                      }
                    >
                      {t('上移')}
                    </Button>
                    <Button
                      size="small"
                      disabled={index === references.length - 1}
                      onClick={() =>
                        setReferences((current) => {
                          const next = [...current]
                          ;[next[index], next[index + 1]] = [
                            next[index + 1],
                            next[index],
                          ]
                          return next
                        })
                      }
                    >
                      {t('下移')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        setReferences((current) =>
                          current.filter((_, selected) => selected !== index),
                        )
                      }
                    >
                      {t('移除')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <Button
          type="primary"
          htmlType="submit"
          loading={submitting}
          disabled={
            !provider ||
            invalidReferences ||
            uploading ||
            (generationType === 'image_to_video' &&
              (!reference ||
                (frameMode === 'first_last_frame' && !lastReference))) ||
            (generationType === 'reference_to_video' &&
              !references.some((ref) => ref.type !== 'audio'))
          }
        >
          {t('提交视频生成')}
        </Button>
      </Form>
      <div className="studio-video-history">
        {tasks.data
          .filter((task) => task.video)
          .map((task) => (
            <VideoTaskCard
              key={task.id}
              task={task}
              onChanged={() => tasks.refresh()}
            />
          ))}
      </div>
    </div>
  )
}
