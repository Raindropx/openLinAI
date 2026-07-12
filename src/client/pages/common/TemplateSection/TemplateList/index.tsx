import { Spin } from 'antd'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTemplates } from '../../../../hooks/useTemplates'
import { TemplateItemList } from './TemplateItemList'

export interface TemplateListRef {
  refresh: () => void
}

export const TemplateList = forwardRef<TemplateListRef, unknown>((_, ref) => {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)

  const { data: templates = [], loading, refresh } = useTemplates()

  useImperativeHandle(ref, () => ({
    refresh,
  }))

  // 只展示图片类模板（image / chat-image 两种引擎都属于图片模板）
  const filteredTemplates = templates
    .filter(
      (t) => t.usageType === 'image' || t.usageType === 'chat-image',
    )
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

  return (
    <>
      <div className="flex max-h-120 w-full flex-col rounded-2xl p-0 md:absolute md:inset-0 md:max-h-none md:p-6">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h3 className="m-0 flex items-center text-base font-semibold text-slate-800 md:text-lg">
            {selectedFolder ? (
              <>
                <span
                  className="cursor-pointer text-slate-500 transition-colors hover:text-blue-600"
                  onClick={() => setSelectedFolder(null)}
                >
                  模板列表 ({filteredTemplates.length})
                </span>
                <span className="mx-2 font-normal text-slate-400">/</span>
                <span>{selectedFolder}</span>
              </>
            ) : (
              <span>模板列表 ({filteredTemplates.length})</span>
            )}
          </h3>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Spin />
            </div>
          ) : (
            <TemplateItemList
              filteredTemplates={filteredTemplates}
              selectedFolder={selectedFolder}
              onSelectFolder={setSelectedFolder}
            />
          )}
        </div>
      </div>
    </>
  )
})
