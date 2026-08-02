import { AppstoreOutlined, EditOutlined } from '@ant-design/icons'
import { useCallback, useRef, useState } from 'react'
import type { TaskTemplate } from '../../../../server/common/template-manager'
import { useGlobalStore } from '../../../store/global'
import { TemplateForm } from '../TemplateSection/TemplateForm'
import {
  TemplateList,
  type TemplateListRef,
} from '../TemplateSection/TemplateList'

export function TemplateEditorPage() {
  const listRef = useRef<TemplateListRef>(null)
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(
    null,
  )
  const setFillTemplateData = useGlobalStore(
    (state) => state.setFillTemplateData,
  )

  const loadTemplate = useCallback(
    (template: TaskTemplate) => {
      setEditingTemplate(template)
      setFillTemplateData(template)
    },
    [setFillTemplateData],
  )

  return (
    <div className="flex min-h-full flex-col gap-3 p-3 lg:h-full lg:min-h-0 lg:p-4">
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400/10 text-lg text-amber-300 ring-1 ring-amber-400/20">
          <EditOutlined />
        </div>
        <div>
          <h1 className="m-0 text-lg font-semibold text-slate-100">
            模板编辑器
          </h1>
          <p className="m-0 mt-0.5 text-xs text-slate-500">
            维护提示词、参考图、分类和生成参数；右侧可直接切换模板
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(520px,1.35fr)_minmax(360px,0.65fr)]">
        <section className="workbench-panel min-h-0 overflow-hidden">
          <div className="workbench-panel-header h-auto! gap-3 py-3">
            <span className="flex items-center gap-2">
              <EditOutlined className="text-amber-300" />
              {editingTemplate?.title || '新模板草稿'}
            </span>
            <span className="text-xs font-normal text-slate-500">
              {editingTemplate ? '保存会更新当前模板' : '请另存为新模板'}
            </span>
          </div>
          <div className="h-[calc(100%-49px)] overflow-y-auto p-4 sm:p-5">
            <TemplateForm
              showHeading={false}
              editorMode
              activeTemplateId={editingTemplate?.id}
              onSuccess={() => listRef.current?.refresh()}
              onTemplateLoaded={(template) =>
                setEditingTemplate(template as TaskTemplate)
              }
              onEditingTemplateChange={setEditingTemplate}
            />
          </div>
        </section>

        <section className="workbench-panel relative min-h-[520px] xl:min-h-0">
          <div className="workbench-panel-header h-auto! gap-3 py-3">
            <span className="flex items-center gap-2">
              <AppstoreOutlined className="text-amber-300" />
              模板库
            </span>
            <span className="text-xs font-normal text-slate-500">
              点击载入后直接编辑
            </span>
          </div>
          <div className="absolute inset-x-0 top-[49px] bottom-0">
            <TemplateList
              ref={listRef}
              onLoadTemplate={loadTemplate}
              activeTemplateId={editingTemplate?.id}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
