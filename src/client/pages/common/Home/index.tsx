import {
  AppstoreOutlined,
  ControlOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { Segmented } from 'antd'
import { useRef, useState } from 'react'
import type { TaskTemplate } from '../../../../server/common/template-manager'
import { useGlobalStore } from '../../../store/global'
import { TaskList } from '../TaskList'
import { TemplateForm } from '../TemplateSection/TemplateForm'
import {
  TemplateList,
  type TemplateListRef,
} from '../TemplateSection/TemplateList'
import { WorkspaceCanvas } from './WorkspaceCanvas'

type ResourcePanel = 'tasks' | 'templates'

export const Home = () => {
  const templateListRef = useRef<TemplateListRef>(null)
  const setFillTemplateData = useGlobalStore(
    (state) => state.setFillTemplateData,
  )
  const [resourcePanel, setResourcePanel] = useState<ResourcePanel>('tasks')
  const [selectedTaskId, setSelectedTaskId] = useState<string>()

  const handleLoadTemplate = (template: TaskTemplate) => {
    setFillTemplateData(template)
  }

  return (
    <div className="grid min-h-full gap-3 p-3 lg:h-full lg:min-h-0 lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:overflow-hidden xl:grid-cols-[340px_minmax(0,1fr)_390px] 2xl:grid-cols-[360px_minmax(0,1fr)_420px]">
      <aside className="workbench-panel flex min-h-[520px] flex-col lg:h-full lg:min-h-0">
        <div className="workbench-panel-header">
          <span className="flex items-center gap-2">
            <ControlOutlined className="text-amber-400" />
            生成参数
          </span>
          <span className="text-[11px] font-normal tracking-wide text-slate-500">
            GENERATION
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TemplateForm
            showHeading={false}
            onSuccess={() => templateListRef.current?.refresh()}
          />
        </div>
      </aside>

      <WorkspaceCanvas
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTaskId}
      />

      <aside className="workbench-panel flex min-h-[520px] flex-col lg:h-full lg:min-h-0">
        <div className="border-b border-[#2d333d] p-2">
          <Segmented<ResourcePanel>
            block
            value={resourcePanel}
            onChange={setResourcePanel}
            options={[
              {
                label: '任务列表',
                value: 'tasks',
                icon: <UnorderedListOutlined />,
              },
              {
                label: '模板',
                value: 'templates',
                icon: <AppstoreOutlined />,
              },
            ]}
          />
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className={resourcePanel === 'tasks' ? 'h-full min-h-0' : 'hidden'}
          >
            <TaskList
              variant="panel"
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
            />
          </div>
          <div
            className={
              resourcePanel === 'templates'
                ? 'relative h-full min-h-0'
                : 'hidden'
            }
          >
            <TemplateList
              ref={templateListRef}
              onLoadTemplate={handleLoadTemplate}
            />
          </div>
        </div>
      </aside>
    </div>
  )
}
