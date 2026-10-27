import {
  AppstoreOutlined,
  ControlOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { Segmented } from 'antd'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { TaskTemplate } from '../../../../server/common/template-manager'
import { useTasks } from '../../../hooks/useTasks'
import { t, useAppLanguage } from '../../../i18n'
import { useGlobalStore } from '../../../store/global'
import { TaskList } from '../TaskList'
import { TemplateForm } from '../TemplateSection/TemplateForm'
import {
  TemplateList,
  type TemplateListRef,
} from '../TemplateSection/TemplateList'
import { WorkspaceCanvas } from './WorkspaceCanvas'

type ResourcePanel = 'tasks' | 'templates'
type MobileWorkspacePanel = 'parameters' | 'canvas' | 'resources'

export const Home = () => {
  useAppLanguage()

  const location = useLocation()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const templateListRef = useRef<TemplateListRef>(null)
  const [desktopLayout, setDesktopLayout] = useState(
    () => window.matchMedia('(min-width: 1024px)').matches,
  )
  const setFillTemplateData = useGlobalStore(
    (state) => state.setFillTemplateData,
  )
  const focusNewestTaskSignal = useGlobalStore(
    (state) => state.focusNewestTaskSignal,
  )
  const { data: tasks = [], folders, loading } = useTasks()
  const folderId = useGlobalStore((state) => state.taskFolderId)
  const [resourcePanel, setResourcePanel] = useState<ResourcePanel>('tasks')
  const [mobilePanel, setMobilePanel] = useState<MobileWorkspacePanel>(() =>
    (location.state as { mobilePanel?: MobileWorkspacePanel } | null)
      ?.mobilePanel === 'parameters'
      ? 'parameters'
      : 'canvas',
  )
  const [selectedTaskId, setSelectedTaskId] = useState<string>()

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const updateLayout = () => setDesktopLayout(media.matches)
    media.addEventListener('change', updateLayout)
    return () => media.removeEventListener('change', updateLayout)
  }, [])

  useLayoutEffect(() => {
    if (desktopLayout) return
    // Mobile panels share the page viewport; do not carry another panel's offset.
    const scrollRoot = workspaceRef.current?.closest<HTMLElement>(
      '[data-mobile-scroll-root]',
    )
    if (scrollRoot) scrollRoot.scrollTop = 0
  }, [mobilePanel, resourcePanel, desktopLayout])

  const imageTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (task.rawTemplate?.usageType === 'image' ||
            task.rawTemplate?.usageType === 'chat-image') &&
          (folderId
            ? task.folderId === folderId
            : !folders.some((folder) => folder.id === task.folderId)),
      ),
    [tasks, folderId, folders],
  )

  // 生成新任务后让画布自动聚焦到最新任务
  const pendingFocusRef = useRef(false)
  const lastFocusedNewestIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (focusNewestTaskSignal > 0) {
      pendingFocusRef.current = true
    }
  }, [focusNewestTaskSignal])

  useEffect(() => {
    if (!pendingFocusRef.current || imageTasks.length === 0) return
    const newest = imageTasks[0]
    if (newest.id !== lastFocusedNewestIdRef.current) {
      setSelectedTaskId(newest.id)
      lastFocusedNewestIdRef.current = newest.id
      pendingFocusRef.current = false
    }
  }, [imageTasks])

  const handleLoadTemplate = (template: TaskTemplate) => {
    setFillTemplateData(template)
  }

  return (
    <div
      ref={workspaceRef}
      className="flex min-h-full flex-col gap-3 p-3 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:overflow-hidden xl:grid-cols-[340px_minmax(0,1fr)_390px] 2xl:grid-cols-[360px_minmax(0,1fr)_420px]"
    >
      <div className="shrink-0 lg:hidden">
        <Segmented<MobileWorkspacePanel>
          block
          value={mobilePanel}
          onChange={setMobilePanel}
          options={[
            {
              label: t('参数'),
              value: 'parameters',
              icon: <ControlOutlined />,
            },
            { label: t('画布'), value: 'canvas', icon: <AppstoreOutlined /> },
            {
              label: t('资源'),
              value: 'resources',
              icon: <UnorderedListOutlined />,
            },
          ]}
        />
      </div>

      <aside
        className={`workbench-panel min-h-[calc(100dvh-9.5rem)] flex-col lg:flex lg:h-full lg:min-h-0 ${mobilePanel === 'parameters' ? 'flex' : 'hidden'}`}
      >
        <div className="workbench-panel-header">
          <span className="flex items-center gap-2">
            <ControlOutlined className="app-accent-text" />
            {t('生成参数')}
          </span>
          <span className="text-[11px] font-normal tracking-wide text-slate-500">
            GENERATION
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TemplateForm
            showHeading={false}
            showQualitySetting
            onSuccess={() => templateListRef.current?.refresh()}
          />
        </div>
      </aside>

      <div
        className={`min-h-[calc(100dvh-9.5rem)] lg:block lg:h-full lg:min-h-0 ${mobilePanel === 'canvas' ? 'block' : 'hidden'}`}
      >
        <WorkspaceCanvas
          imageTasks={imageTasks}
          loading={loading}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />
      </div>

      <aside
        className={`workbench-panel min-h-[calc(100dvh-9.5rem)] flex-col lg:flex lg:h-full lg:min-h-0 ${mobilePanel === 'resources' ? 'flex' : 'hidden'}`}
      >
        <div className="border-b border-[#2d333d] p-2">
          <Segmented<ResourcePanel>
            block
            value={resourcePanel}
            onChange={setResourcePanel}
            options={[
              {
                label: t('任务列表'),
                value: 'tasks',
                icon: <UnorderedListOutlined />,
              },
              {
                label: t('模板'),
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
              active={
                resourcePanel === 'tasks' &&
                (desktopLayout || mobilePanel === 'resources')
              }
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
