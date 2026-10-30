import { Alert, Button, Card, message, Modal, Progress, Space, Tag } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '../../../../server/common/task-manager'
import {
  VIDEO_GENERATION_LABELS,
  VIDEO_RETRIEVAL_LABELS,
  videoModeLabel,
  type VideoSources,
} from '../../../../shared/video'
import { t, useAppLanguage } from '../../../i18n'
import { studioJson, studioRequest } from './api'

export function VideoTaskCard({
  task,
  onChanged,
  onRefill,
  variant = 'default',
}: {
  task: Task
  onChanged?: () => void
  onRefill?: () => void
  variant?: 'default' | 'preview'
}) {
  useAppLanguage()
  const video = task.video!
  const [sources, setSources] = useState<VideoSources>({})
  const [playing, setPlaying] = useState(false)
  const [playbackUrl, setPlaybackUrl] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [playError, setPlayError] = useState('')
  const player = useRef<HTMLVideoElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const visible = useRef(false)
  const actionPending = useRef(false)
  const base = `/videos/${encodeURIComponent(task.id)}`
  const resolveSources = useCallback(async () => {
    const value = await studioRequest<VideoSources>(`${base}/sources`)
    setSources(value)
    return value
  }, [base])

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting
      if (!entry.isIntersecting) player.current?.pause()
      else if (video.generationStatus === 'succeeded')
        void resolveSources().catch(() => {})
    })
    if (container.current) observer.observe(container.current)
    const timer = setInterval(() => {
      if (visible.current && video.generationStatus === 'succeeded')
        void resolveSources().catch(() => {})
    }, 30000)
    return () => {
      observer.disconnect()
      clearInterval(timer)
      player.current?.pause()
    }
  }, [
    resolveSources,
    video.generationStatus,
    video.retrievalStatus,
    video.result?.localFileId,
  ])

  async function action(suffix: string, method = 'POST') {
    if (actionPending.current) return false
    actionPending.current = true
    setBusy(true)
    try {
      await studioRequest(`${base}/${suffix}`, studioJson(method, {}))
      onChanged?.()
      if (video.generationStatus === 'succeeded')
        await resolveSources().catch(() => {})
      return true
    } catch (error) {
      message.error((error as Error).message)
      return false
    } finally {
      actionPending.current = false
      setBusy(false)
    }
  }

  async function preview() {
    try {
      setPlayError('')
      const value = await resolveSources()
      if (!value.playbackUrl) throw new Error(value.error || '视频暂不可播放')
      setPlaybackUrl(value.playbackUrl)
      setPlaying(true)
      if (player.current?.getAttribute('src') === value.playbackUrl)
        player.current.load()
    } catch (error) {
      setPlayError((error as Error).message)
    }
  }

  async function download() {
    try {
      const value = await resolveSources()
      if (!value.downloadUrl) throw new Error(value.error || '视频暂不可下载')
      const link = document.createElement('a')
      link.href = value.downloadUrl
      link.download = ''
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  function deleteTask(removeFile: boolean) {
    Modal.confirm({
      title: t(removeFile ? '删除任务及本地视频？' : '仅删除视频任务记录？'),
      content: t(
        removeFile
          ? '本地文件将永久删除；此操作不会取消服务商的远端任务。'
          : '本地视频文件保留在外接目录，但删除记录后应用将无法再访问它。此操作不会取消远端任务。',
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        const response = await fetch(
          `/api/task/${task.id}?keepImage=${removeFile ? 'false' : 'true'}`,
          { method: 'DELETE' },
        )
        const result = await response.json()
        if (!response.ok || !result.success) {
          message.error(t('删除失败，请检查存储与任务状态'))
          throw new Error('delete failed')
        }
        onChanged?.()
      },
    })
  }

  const retrievalActive =
    video.retrievalStatus === 'queued' ||
    video.retrievalStatus === 'downloading'
  const bytes = (video.retrievalBytes / 1024 / 1024).toFixed(1)
  return (
    <div
      ref={container}
      className={
        variant === 'preview' ? 'studio-video-preview-card' : undefined
      }
      onClick={(event) => event.stopPropagation()}
    >
      <Card
        size="small"
        title={variant === 'preview' ? undefined : t('视频生成')}
        style={{ width: '100%' }}
      >
        <Space wrap>
          <Tag color="purple">
            {t(videoModeLabel(video.request.generationType))}
          </Tag>
          {video.request.generationType === 'image_to_video' && (
            <Tag>
              {t(
                video.request.frameMode === 'first_last_frame'
                  ? '首尾帧'
                  : '首帧',
              )}
            </Tag>
          )}
          <Tag>
            {t(
              video.generationStatus === 'queued' && video.remoteTaskId
                ? '云端排队中'
                : VIDEO_GENERATION_LABELS[video.generationStatus],
            )}
          </Tag>
          <Tag
            color={video.retrievalStatus === 'retrieved' ? 'green' : undefined}
          >
            {t(VIDEO_RETRIEVAL_LABELS[video.retrievalStatus])}
          </Tag>
          {sources.source && (
            <Tag>
              {sources.source === 'local' ? t('本地存储') : t('云端直连')}
            </Tag>
          )}
          <span>
            {video.request.provider} · {video.request.model}
          </span>
        </Space>
        <p style={{ marginBottom: 0 }}>
          {video.request.durationSeconds}s · {video.request.resolution} ·{' '}
          {video.request.aspectRatio}
        </p>
        <p
          className="studio-video-detail-prompt"
          style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            maxHeight: variant === 'preview' ? 44 : 100,
            overflow: 'auto',
          }}
        >
          {video.request.prompt}
        </p>
        {playing && playbackUrl ? (
          <video
            className="studio-video-player"
            key={playbackUrl}
            ref={player}
            data-linai-video
            controls
            playsInline
            preload="none"
            src={playbackUrl}
            poster={video.result?.posterUrl}
            style={{
              width: '100%',
              maxHeight: variant === 'preview' ? 240 : 360,
            }}
            onPlay={() =>
              document
                .querySelectorAll<HTMLVideoElement>('video[data-linai-video]')
                .forEach((element) => {
                  if (element !== player.current) element.pause()
                })
            }
            onError={() => {
              setPlayError(t('视频播放失败。可刷新云端链接或下载后播放。'))
              void resolveSources().catch(() => {})
            }}
          />
        ) : (
          <div
            className="studio-video-player-placeholder"
            style={{
              minHeight: variant === 'preview' ? 120 : 80,
              display: 'grid',
              placeItems: 'center',
              background:
                variant === 'preview'
                  ? 'var(--task-list-card-media-bg)'
                  : 'var(--studio-panel)',
            }}
          >
            {video.result?.posterUrl && (
              <img
                src={video.result.posterUrl}
                loading="lazy"
                alt={t('视频封面')}
                style={{ maxHeight: 140, maxWidth: '100%' }}
              />
            )}
            <span>
              {video.result?.durationSeconds
                ? `${video.result.durationSeconds}s · `
                : ''}
              {t(
                video.generationStatus === 'succeeded'
                  ? '点击预览后加载视频'
                  : VIDEO_GENERATION_LABELS[video.generationStatus],
              )}
            </span>
          </div>
        )}
        {(retrievalActive ||
          video.retrievalStatus === 'paused' ||
          !!video.retrievalCheckpoint) && (
          <div>
            {video.retrievalTotalBytes ? (
              <Progress
                percent={Math.min(
                  99,
                  Math.round(
                    (video.retrievalBytes / video.retrievalTotalBytes) * 100,
                  ),
                )}
                size="small"
              />
            ) : null}
            <small>
              {t('已传输')} {bytes} MiB
              {video.retrievalTotalBytes
                ? ` / ${(video.retrievalTotalBytes / 1024 / 1024).toFixed(1)} MiB`
                : ''}
            </small>
          </div>
        )}
        {video.retrievalNotice && (
          <Alert
            type="info"
            showIcon
            title={t(video.retrievalNotice)}
            style={{ marginTop: 8 }}
          />
        )}
        {video.retrievalStatus === 'paused' && !video.retrievalCheckpoint && (
          <Alert
            type="info"
            title={t('没有可验证的断点，继续时将从头取回')}
            style={{ marginTop: 8 }}
          />
        )}
        {[video.error, video.retrievalError, sources.error, playError]
          .filter(Boolean)
          .map((error, index) => (
            <Alert
              key={index}
              type="warning"
              showIcon
              title={t(error!)}
              style={{ marginTop: 8 }}
            />
          ))}
        <Space
          className="studio-video-task-actions"
          wrap
          style={
            variant === 'preview' ? { marginBottom: 10 } : { marginTop: 12 }
          }
        >
          {onRefill && (
            <Button size="small" onClick={onRefill}>
              {t('回填')}
            </Button>
          )}
          {video.generationStatus === 'succeeded' && (
            <>
              <Button size="small" onClick={() => void preview()}>
                {t('预览 / 播放')}
              </Button>
              <Button size="small" onClick={() => void download()}>
                {t('下载到设备')}
              </Button>
              {retrievalActive ? (
                <Button
                  size="small"
                  loading={busy}
                  onClick={() => void action('pause-retrieval')}
                >
                  {t('暂停取回')}
                </Button>
              ) : (
                <Button
                  size="small"
                  loading={busy}
                  disabled={sources.source === 'local'}
                  onClick={() => void action('retrieve')}
                >
                  {t(
                    video.retrievalStatus === 'paused' ||
                      video.retrievalCheckpoint
                      ? '继续取回'
                      : video.retrievalStatus === 'failed' ||
                          video.retrievalStatus === 'cancelled'
                        ? '重新取回'
                        : '取回',
                  )}
                </Button>
              )}
              {(video.retrievalCheckpoint ||
                video.retrievalStatus === 'paused') &&
                !retrievalActive && (
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() =>
                      Modal.confirm({
                        title: t('丢弃断点并从头取回？'),
                        content: t(
                          '已下载的临时内容将清除，重新下载完整视频。',
                        ),
                        onOk: async () => {
                          if (!(await action('restart-retrieval')))
                            throw new Error('restart failed')
                        },
                      })
                    }
                  >
                    {t('从头取回')}
                  </Button>
                )}
              {(retrievalActive ||
                video.retrievalStatus === 'paused' ||
                video.retrievalCheckpoint) && (
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() =>
                    Modal.confirm({
                      title: t('取消取回并清除断点？'),
                      content: t('只清除临时下载，保留生成结果和任务记录。'),
                      onOk: async () => {
                        if (!(await action('cancel-retrieval')))
                          throw new Error('cancel failed')
                      },
                    })
                  }
                >
                  {t('取消取回')}
                </Button>
              )}
              <Button
                size="small"
                loading={busy}
                onClick={() => {
                  setPlayError('')
                  void action('refresh')
                }}
              >
                {t('刷新云端链接')}
              </Button>
              {video.result?.localFileId && (
                <Button
                  size="small"
                  danger
                  disabled={busy}
                  onClick={() =>
                    Modal.confirm({
                      title: t('删除本地视频文件？'),
                      content: t(
                        '保留任务记录。云端链接可能已过期，请确认后再删除。',
                      ),
                      onOk: async () => {
                        if (!(await action('local', 'DELETE')))
                          throw new Error('delete failed')
                      },
                    })
                  }
                >
                  {t('删除本地文件')}
                </Button>
              )}
            </>
          )}
          {(video.generationStatus === 'failed' ||
            video.generationStatus === 'cancelled') && (
            <Button
              size="small"
              loading={busy}
              onClick={() =>
                Modal.confirm({
                  title: t(
                    video.remoteTaskId
                      ? '恢复查询云端任务？'
                      : '重新提交生成？',
                  ),
                  content: t(
                    video.remoteTaskId
                      ? '沿用已保存的远端任务编号，不创建新任务。'
                      : '未收到远端任务编号时，之前的请求也可能已被接单。请先核对服务商记录，重试可能再次计费。',
                  ),
                  onOk: async () => {
                    if (!(await action('retry')))
                      throw new Error('retry failed')
                  },
                })
              }
            >
              {t(video.remoteTaskId ? '恢复状态查询' : '重试生成')}
            </Button>
          )}
          <Button
            size="small"
            danger
            disabled={busy}
            onClick={() => deleteTask(false)}
          >
            {t('仅删除记录')}
          </Button>
          {video.result?.localFileId && (
            <Button
              size="small"
              danger
              disabled={busy}
              onClick={() => deleteTask(true)}
            >
              {t('删除记录和本地视频')}
            </Button>
          )}
        </Space>
      </Card>
    </div>
  )
}
