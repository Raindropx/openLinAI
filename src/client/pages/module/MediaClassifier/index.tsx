import { Card, Spin, Tabs, message } from 'antd'
import { useEffect, useState } from 'react'
import { getMediaWorkspace, pickMediaFolder, saveMediaWorkspace } from './api'
import { DirectorySelector } from './components/DirectorySelector'
import { OriginalImageTab } from './components/OriginalImageTab'
import { PlaceholderTab } from './components/PlaceholderTab'
import { ScreenedImageTab } from './components/ScreenedImageTab'
import { TrashImageTab } from './components/TrashImageTab'
import type { MediaWorkspaceKind, MediaWorkspaceSnapshot } from './types'

export function MediaClassifier() {
  const [workspace, setWorkspace] = useState<MediaWorkspaceSnapshot | null>(
    null,
  )
  const [sourceDir, setSourceDir] = useState('')
  const [resultDir, setResultDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pickingKind, setPickingKind] = useState<MediaWorkspaceKind | null>(
    null,
  )

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

  const handlePickFolder = async (kind: MediaWorkspaceKind) => {
    setPickingKind(kind)
    try {
      const currentPath = kind === 'source' ? sourceDir : resultDir
      const result = await pickMediaFolder(kind, currentPath)
      if (!result.path) {
        message.info('已取消选择')
        return
      }

      if (kind === 'source') {
        setSourceDir(result.path)
      } else {
        setResultDir(result.path)
      }
    } catch (error: any) {
      message.error(error.message || '打开文件夹选择器失败')
    } finally {
      setPickingKind(null)
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

  return (
    <div className="space-y-4">
      <DirectorySelector
        sourceDir={sourceDir}
        resultDir={resultDir}
        workspace={workspace}
        saving={saving}
        pickingKind={pickingKind}
        onSourceDirChange={setSourceDir}
        onResultDirChange={setResultDir}
        onPickFolder={handlePickFolder}
        onSave={handleSaveWorkspace}
      />

      {loading ? (
        <Card className="border-slate-200 shadow-sm">
          <div className="flex min-h-[320px] items-center justify-center">
            <Spin />
          </div>
        </Card>
      ) : (
        <Tabs
          size="large"
          defaultActiveKey="original"
          items={[
            {
              key: 'original',
              label: '原始图片',
              children: (
                <OriginalImageTab
                  workspace={workspace}
                  refreshKey={refreshKey}
                  onMutated={handleMutated}
                />
              ),
            },
            {
              key: 'screened',
              label: '筛选后的图片',
              children: (
                <ScreenedImageTab
                  workspace={workspace}
                  refreshKey={refreshKey}
                />
              ),
            },
            {
              key: 'classified',
              label: '分类后的图片',
              children: (
                <PlaceholderTab
                  title="分类后的图片"
                  description="该页先搭建分类展示结构，后续会继续补充自动分类和目录归档能力。"
                />
              ),
            },
            {
              key: 'trash',
              label: '回收站',
              children: (
                <TrashImageTab
                  workspace={workspace}
                  refreshKey={refreshKey}
                  onMutated={handleMutated}
                />
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
