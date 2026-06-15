import { Card, Spin, Tabs, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { getAllMediaImages, getMediaWorkspace, saveMediaWorkspace } from './api'
import { DirectorySelector } from './components/DirectorySelector'
import { OriginalImageTab } from './components/OriginalImageTab'
import { PlaceholderTab } from './components/PlaceholderTab'
import { ScreenedImageTab } from './components/ScreenedImageTab'
import { TrashImageTab } from './components/TrashImageTab'
import { mergeMediaImagesWithLocalMarks } from './localMarks'
import type { MediaImageItem, MediaWorkspaceSnapshot } from './types'

export function MediaClassifier() {
  const [workspace, setWorkspace] = useState<MediaWorkspaceSnapshot | null>(
    null,
  )
  const [sourceDir, setSourceDir] = useState('')
  const [resultDir, setResultDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [images, setImages] = useState<MediaImageItem[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)

  const syncWorkspace = (nextWorkspace: MediaWorkspaceSnapshot) => {
    setWorkspace(nextWorkspace)
    setSourceDir(nextWorkspace.sourceDir)
    setResultDir(nextWorkspace.resultDir)
  }

  const loadWorkspace = async (silent = false) => {
    if (!silent) {
      setLoading(true)
    }

    try {
      const nextWorkspace = await getMediaWorkspace()
      syncWorkspace(nextWorkspace)
    } catch (error: any) {
      message.error(error.message || '获取图片整理工作区失败')
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadWorkspace()
  }, [])

  const loadImages = async (silent = false) => {
    if (!silent) {
      setImagesLoading(true)
    }

    try {
      const nextImages = await getAllMediaImages()
      setImages(mergeMediaImagesWithLocalMarks(nextImages))
    } catch (error: any) {
      message.error(error.message || '获取图片失败')
    } finally {
      if (!silent) {
        setImagesLoading(false)
      }
    }
  }

  const handleSaveWorkspace = async () => {
    setSaving(true)
    try {
      const nextWorkspace = await saveMediaWorkspace(sourceDir, resultDir)
      syncWorkspace(nextWorkspace)
      setRefreshKey((value) => value + 1)
      message.success('目录已应用')
    } catch (error: any) {
      message.error(error.message || '保存目录失败')
    } finally {
      setSaving(false)
    }
  }

  const handleMutated = async () => {
    await loadWorkspace(true)
    setRefreshKey((value) => value + 1)
  }

  const configured = Boolean(workspace?.sourceDir && workspace?.resultDir)

  useEffect(() => {
    if (!configured) {
      setImages([])
      return
    }

    void loadImages()
  }, [configured, refreshKey])

  const summary = useMemo(() => {
    const originalCount = images.length
    const screenedCount = images.filter((item) => item.status === 'keep').length
    const trashCount = images.filter((item) => item.status === 'delete').length

    return {
      originalCount,
      screenedCount,
      trashCount,
      classifiedCount: 0,
      pendingCount: Math.max(originalCount - screenedCount - trashCount, 0),
    }
  }, [images])

  const screenedImages = useMemo(
    () => images.filter((item) => item.status === 'keep'),
    [images],
  )
  if (loading) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <div className="flex min-h-[320px] items-center justify-center">
          <Spin />
        </div>
      </Card>
    )
  }

  if (!configured) {
    return (
      <DirectorySelector
        sourceDir={sourceDir}
        resultDir={resultDir}
        saving={saving}
        onSourceDirChange={setSourceDir}
        onResultDirChange={setResultDir}
        onSave={handleSaveWorkspace}
      />
    )
  }

  return (
    <div className="space-y-4">
      <Tabs
        size="large"
        defaultActiveKey="original"
        items={[
          {
            key: 'original',
            label: `总图片（${summary.originalCount}）`,
            children: (
              <OriginalImageTab
                images={images}
                loading={imagesLoading}
                onImagesChange={setImages}
              />
            ),
          },
          {
            key: 'screened',
            label: `筛选后的图片（${summary.screenedCount}）`,
            children: (
              <ScreenedImageTab
                images={screenedImages}
                loading={imagesLoading}
                refreshKey={refreshKey}
              />
            ),
          },
          {
            key: 'classified',
            label: `分类后的图片（${summary.classifiedCount}）`,
            children: (
              <PlaceholderTab
                title="分类后的图片"
                description="该页先搭建分类展示结构，后续会继续补充自动分类和目录归档能力。"
              />
            ),
          },
          {
            key: 'trash',
            label: `回收站（${summary.trashCount}）`,
            children: (
              <TrashImageTab
                images={images}
                onImagesChange={setImages}
                loading={imagesLoading}
                refreshKey={refreshKey}
                onMutated={handleMutated}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
