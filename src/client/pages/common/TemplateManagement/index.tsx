import { AppstoreOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { TaskTemplate } from '../../../../server/common/template-manager'
import { useGlobalStore } from '../../../store/global'
import { TemplateList } from '../TemplateSection/TemplateList'

export function TemplateManagementPage() {
  const navigate = useNavigate()
  const setFillTemplateData = useGlobalStore(
    (state) => state.setFillTemplateData,
  )

  const handleLoadTemplate = (template: TaskTemplate) => {
    setFillTemplateData(template)
    navigate('/template-editor')
  }

  return (
    <div className="flex min-h-full flex-col gap-3 p-3 lg:h-full lg:min-h-0 lg:p-4">
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400/10 text-lg text-amber-300 ring-1 ring-amber-400/20">
          <AppstoreOutlined />
        </div>
        <div>
          <h1 className="m-0 text-lg font-semibold text-slate-100">模板管理</h1>
          <p className="m-0 mt-0.5 text-xs text-slate-500">
            整理、编辑和载入已有模板
          </p>
        </div>
      </div>

      <section className="workbench-panel relative min-h-[calc(100dvh-10rem)] flex-1 lg:min-h-0">
        <TemplateList
          variant="management"
          onLoadTemplate={handleLoadTemplate}
        />
      </section>
    </div>
  )
}
