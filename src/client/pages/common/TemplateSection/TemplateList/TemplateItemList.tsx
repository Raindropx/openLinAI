import { InboxOutlined } from '@ant-design/icons'
import { Pagination, message } from 'antd'
import { hc } from 'hono/client'
import { useCallback, useEffect, useState } from 'react'
import type { AppType } from '../../../../../server'
import type { TaskTemplate } from '../../../../../server/common/template-manager'
import { useTemplates } from '../../../../hooks/useTemplates'
import { InfiniteScrollSentinel } from '../../components/InfiniteScrollSentinel'
import { TemplateFolder } from '../TemplateItem/TemplateFolder'
import {
  TemplateItem,
  type TemplateDropPosition,
} from '../TemplateItem/TemplateItem'

const client = hc<AppType>('/')

interface TemplateItemListProps {
  filteredTemplates: TaskTemplate[]
  selectedFolder: string | null
  onSelectFolder: (folder: string | null) => void
  onLoadTemplate: (template: TaskTemplate) => void
  layout?: 'list' | 'grid'
  selectionMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (templateId: string) => void
  draggable?: boolean
  infiniteScroll?: boolean
  pageSize?: number
  activeTemplateId?: string | null
  clickToLoad?: boolean
}

export function TemplateItemList({
  filteredTemplates,
  selectedFolder,
  onSelectFolder,
  onLoadTemplate,
  layout = 'list',
  selectionMode = false,
  selectedIds = [],
  onToggleSelect,
  draggable = true,
  infiniteScroll = true,
  pageSize = 8,
  activeTemplateId = null,
  clickToLoad = false,
}: TemplateItemListProps) {
  const { refresh: refreshTemplates } = useTemplates()
  const [page, setPage] = useState(0)
  const [visibleCount, setVisibleCount] = useState(pageSize)

  const handleDropTemplate = async (templateId: string, folder: string) => {
    try {
      const res = await client.api.template[':id'].$put({
        param: { id: templateId },
        json: { folder },
      })
      const json = await res.json()
      if (json.success) {
        message.success(folder ? '已移动到文件夹' : '已移出文件夹')
        refreshTemplates()
      } else {
        message.error(json.error || '移动失败')
      }
    } catch (error) {
      const msg =
        error instanceof Error ? `[网络] ${error.message}` : '请求失败'
      message.error(msg)
    }
  }

  const handleReorderTemplate = async (
    draggedId: string,
    targetId: string,
    position: TemplateDropPosition,
  ) => {
    if (draggedId === targetId) return

    const reorderedTemplates = [...displayTemplates]
    const draggedIndex = reorderedTemplates.findIndex(
      (template) => template.id === draggedId,
    )
    if (draggedIndex === -1) return

    const [draggedTemplate] = reorderedTemplates.splice(draggedIndex, 1)
    const targetIndex = reorderedTemplates.findIndex(
      (template) => template.id === targetId,
    )
    if (targetIndex === -1) return

    reorderedTemplates.splice(
      targetIndex + (position === 'after' ? 1 : 0),
      0,
      draggedTemplate,
    )

    try {
      const res = await client.api.template.order.$put({
        json: { orderedIds: reorderedTemplates.map((template) => template.id) },
      })
      const json = await res.json()
      if (json.success) {
        message.success('模板顺序已保存')
        refreshTemplates()
      } else {
        message.error(json.error || '调整顺序失败')
      }
    } catch (error) {
      const msg =
        error instanceof Error ? `[网络] ${error.message}` : '请求失败'
      message.error(msg)
    }
  }

  const folders = Array.from(
    new Set(filteredTemplates.map((t) => t.folder).filter(Boolean)),
  ) as string[]

  const displayTemplates = selectedFolder
    ? filteredTemplates.filter((t) => t.folder === selectedFolder)
    : filteredTemplates.filter((t) => !t.folder)

  const displayFolders = selectedFolder
    ? []
    : folders.sort((a, b) => a.localeCompare(b))
  const showFolderArea = Boolean(selectedFolder) || displayFolders.length > 0
  const visibleTemplates = infiniteScroll
    ? displayTemplates.slice(0, visibleCount)
    : displayTemplates.slice(page * pageSize, page * pageSize + pageSize)
  const hasMoreTemplates =
    infiniteScroll && visibleCount < displayTemplates.length
  const loadMoreTemplates = useCallback(() => {
    setVisibleCount((count) =>
      Math.min(count + pageSize, displayTemplates.length),
    )
  }, [displayTemplates.length, pageSize])

  useEffect(() => {
    setPage(0)
    setVisibleCount(pageSize)
  }, [filteredTemplates, infiniteScroll, pageSize, selectedFolder])

  useEffect(() => {
    if (page > 0 && page * pageSize >= displayTemplates.length) setPage(0)
  }, [displayTemplates.length, page, pageSize])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        {!showFolderArea && displayTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center space-y-4 rounded-xl border border-dashed border-[#343a44] bg-[#15181d] py-12 text-slate-500">
            <InboxOutlined className="text-5xl text-slate-600" />
            <p className="text-sm font-medium">该分类下暂无模板内容</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {showFolderArea && (
              <div
                className={
                  layout === 'grid'
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3'
                    : 'grid grid-cols-2 gap-2'
                }
              >
                {selectedFolder && (
                  <TemplateFolder
                    folder=".."
                    count={0}
                    isParent
                    dropFolder=""
                    onClick={() => onSelectFolder(null)}
                    onDropTemplate={handleDropTemplate}
                  />
                )}
                {displayFolders.map((folder) => {
                  const count = filteredTemplates.filter(
                    (t) => t.folder === folder,
                  ).length
                  return (
                    <TemplateFolder
                      key={folder}
                      folder={folder}
                      count={count}
                      onClick={() => onSelectFolder(folder)}
                      onDropTemplate={handleDropTemplate}
                      onRenameSuccess={() => {
                        refreshTemplates()
                      }}
                    />
                  )
                })}
              </div>
            )}

            <div
              className={
                layout === 'grid'
                  ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] items-stretch gap-4'
                  : 'flex flex-col gap-2'
              }
            >
              {visibleTemplates.map((template) => (
                <TemplateItem
                  key={template.id}
                  template={template}
                  variant={layout === 'grid' ? 'tile' : 'list'}
                  draggable={draggable && !selectionMode}
                  selectionMode={selectionMode}
                  selected={selectedIds.includes(template.id)}
                  onToggleSelect={onToggleSelect}
                  onLoad={onLoadTemplate}
                  onReorder={handleReorderTemplate}
                  active={template.id === activeTemplateId}
                  clickToLoad={clickToLoad}
                />
              ))}
            </div>

            {hasMoreTemplates ? (
              <InfiniteScrollSentinel
                hasMore={hasMoreTemplates}
                onLoadMore={loadMoreTemplates}
              />
            ) : (
              !infiniteScroll &&
              displayTemplates.length > pageSize && (
                <div className="mt-1 flex justify-center">
                  <Pagination
                    current={page + 1}
                    pageSize={pageSize}
                    showSizeChanger={false}
                    simple={layout === 'list'}
                    total={displayTemplates.length}
                    onChange={(nextPage) => setPage(nextPage - 1)}
                  />
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
