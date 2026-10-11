import {
  ArrowLeftOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Alert, Button, Image, Pagination, Spin, Tag, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTasks } from '../../../hooks/useTasks'
import { useThumbnailCacheVersion } from '../../../hooks/useThumbnailCacheVersion'
import { t, useAppLanguage } from '../../../i18n'
import { useGlobalStore } from '../../../store/global'
import { imageThumbnailUrl, localImageVariant } from '../../../utils/imageUrls'

const PAGE_SIZE = 24

function GeneratedImageCard({
  url,
  name,
  endpoint,
  selected,
  onSelect,
  onPreview,
  onSend,
}: {
  url: string
  name: string
  endpoint?: string
  selected: boolean
  onSelect: () => void
  onPreview: () => void
  onSend: () => void
}) {
  const version = useThumbnailCacheVersion()
  const [loaded, setLoaded] = useState(false)
  const [info, setInfo] = useState<{
    width?: number
    height?: number
    bytes?: number
  }>()
  const metadataUrl = localImageVariant(url, 'metadata')

  useEffect(() => {
    if (!loaded || !metadataUrl) return
    const controller = new AbortController()
    fetch(metadataUrl, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((metadata) => {
        if (!controller.signal.aborted && metadata) setInfo(metadata)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [loaded, metadataUrl])

  return (
    <article className={`studio-item ${selected ? 'is-selected' : ''}`}>
      <button
        className="studio-item-preview"
        onClick={onPreview}
        aria-label={t('预览 {0}', [name])}
      >
        <img
          src={imageThumbnailUrl(url, version)}
          alt={name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(event) => {
            setLoaded(true)
            if (!metadataUrl) {
              const image = event.currentTarget
              setInfo({
                width: image.naturalWidth,
                height: image.naturalHeight,
              })
            }
          }}
        />
        {info?.width && info.height ? (
          <span className="studio-item-resolution">
            {info.width}×{info.height}
          </span>
        ) : null}
      </button>
      <div className="studio-item-info" onClick={onSelect}>
        <div className="studio-item-title">
          <strong title={name}>{name}</strong>
        </div>
        <div className="studio-item-tags">
          <Tag color="blue">{t('来自任务')}</Tag>
          {endpoint && <Tag>{endpoint}</Tag>}
        </div>
        {info?.bytes !== undefined && (
          <span className="studio-item-size">
            {(info.bytes / 1024 / 1024).toFixed(2)} MiB
          </span>
        )}
        <div className="studio-item-actions">
          <Tooltip title={t('在拼豆 / 像素图打开')}>
            <Button
              size="small"
              icon={<ArrowLeftOutlined />}
              aria-label={t('在拼豆 / 像素图打开 {0}', [name])}
              onClick={onSend}
            />
          </Tooltip>
        </div>
      </div>
    </article>
  )
}

export function GeneratedImageShelf({
  onSendImage,
}: {
  onSendImage: (url: string) => void
}) {
  useAppLanguage()
  const { data: tasks, folders, loading, error, refresh } = useTasks()
  const folderId = useGlobalStore((state) => state.taskFolderId)
  const currentFolder = folders.find((folder) => folder.id === folderId)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string>()
  const [preview, setPreview] = useState<{ url: string; name: string }>()
  useEffect(() => {
    setPage(1)
    setSelectedId(undefined)
    setPreview(undefined)
  }, [folderId])
  const images = useMemo(
    () =>
      tasks
        .filter((task) =>
          folderId
            ? task.folderId === folderId
            : !folders.some((folder) => folder.id === task.folderId),
        )
        .flatMap((task) => {
          const urls = task.outputUrls?.length
            ? task.outputUrls
            : task.outputUrl
              ? [task.outputUrl]
              : []
          return urls.map((url, index) => ({
            id: `${task.id}:${index}:${url}`,
            url,
            title: task.rawTemplate?.title,
            index: index + 1,
            count: urls.length,
            endpoint: task.endpointName,
          }))
        }),
    [tasks, folderId, folders],
  )
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(images.length / PAGE_SIZE)),
  )

  return (
    <>
      <header className="studio-shelf-header">
        <div>
          <strong>
            <InboxOutlined /> {t('生成图片')}
          </strong>
          <span>{currentFolder?.name || t('主文件夹')}</span>
          <span>{t('共 {0} 张图片', [images.length])}</span>
        </div>
        <Button
          type="text"
          icon={<ReloadOutlined />}
          onClick={refresh}
          aria-label={t('刷新生成图片')}
        />
      </header>
      {error && (
        <Alert
          type="error"
          title={t(error.message)}
          showIcon
          action={
            <Button size="small" onClick={refresh}>
              {t('重试')}
            </Button>
          }
        />
      )}
      <div className="studio-shelf-list studio-generated-list">
        {loading && !images.length ? (
          <Spin />
        ) : !images.length ? (
          <div className="studio-shelf-empty">
            <InboxOutlined />
            <strong>{t('暂无生成图片')}</strong>
            <p>{t('任务生成的图片会显示在这里，点击 ← 载入原图画板。')}</p>
          </div>
        ) : (
          images
            .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
            .map((image) => {
              const name = image.title
                ? `${image.title}${image.count > 1 ? ` · ${image.index}` : ''}`
                : t('生成结果 {0}', [image.index])
              return (
                <GeneratedImageCard
                  key={image.id}
                  url={image.url}
                  name={name}
                  endpoint={image.endpoint}
                  selected={selectedId === image.id}
                  onSelect={() => setSelectedId(image.id)}
                  onPreview={() => {
                    setSelectedId(image.id)
                    setPreview({ url: image.url, name })
                  }}
                  onSend={() => {
                    setSelectedId(image.id)
                    onSendImage(image.url)
                  }}
                />
              )
            })
        )}
      </div>
      {images.length > PAGE_SIZE && (
        <footer className="studio-shelf-footer">
          <Pagination
            size="small"
            simple
            current={currentPage}
            pageSize={PAGE_SIZE}
            total={images.length}
            showSizeChanger={false}
            onChange={setPage}
          />
        </footer>
      )}
      {preview && (
        <Image
          style={{ display: 'none' }}
          src={preview.url}
          alt={preview.name}
          preview={{
            open: true,
            onOpenChange: (open) => {
              if (!open) setPreview(undefined)
            },
          }}
        />
      )}
    </>
  )
}
