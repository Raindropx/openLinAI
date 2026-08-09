import { Select, Switch } from 'antd'
import { useLocalSetting } from '../../../hooks/useLocalSetting'

export function InterfaceSetting() {
  const { gptImageSettings, setGptImageSettings } = useLocalSetting()

  const listSettings = [
    {
      key: 'workspace' as const,
      label: '工作台右侧列表',
      description: '同时控制右侧任务列表与模板列表。',
      infiniteKey: 'workspaceListInfiniteScroll' as const,
      pageSizeKey: 'workspaceListPageSize' as const,
      infinite: gptImageSettings.workspaceListInfiniteScroll ?? true,
      pageSize: gptImageSettings.workspaceListPageSize ?? 8,
      options: [6, 8, 12, 20, 30],
    },
    {
      key: 'task-manager' as const,
      label: '任务列表管理器',
      description: '控制任务管理页面的加载方式。',
      infiniteKey: 'taskManagerInfiniteScroll' as const,
      pageSizeKey: 'taskManagerPageSize' as const,
      infinite: gptImageSettings.taskManagerInfiniteScroll ?? true,
      pageSize: gptImageSettings.taskManagerPageSize ?? 12,
      options: [8, 12, 20, 30, 50],
    },
    {
      key: 'template-manager' as const,
      label: '模板管理器',
      description: '控制模板管理页面的加载方式。',
      infiniteKey: 'templateManagerInfiniteScroll' as const,
      pageSizeKey: 'templateManagerPageSize' as const,
      infinite: gptImageSettings.templateManagerInfiniteScroll ?? true,
      pageSize: gptImageSettings.templateManagerPageSize ?? 12,
      options: [8, 12, 20, 30, 50],
    },
  ]

  return (
    <div className="space-y-6 px-4 py-2">
      <div>
        <div className="font-medium text-slate-200">列表加载</div>
        <div className="mt-1 text-sm text-slate-500">
          无限滚动关闭后会改用分页；条数统一在这里设置，列表底部不再显示条数选择器。
        </div>
      </div>

      {listSettings.map((item) => (
        <div
          key={item.key}
          className="rounded-lg border border-[#303640] bg-[#181c22] p-4"
        >
          <div className="flex items-start justify-between gap-6">
            <div>
              <div>{item.label}</div>
              <div className="mt-1 text-sm text-slate-500">
                {item.description}
              </div>
            </div>
            <Switch
              checked={item.infinite}
              checkedChildren="无限滚动"
              unCheckedChildren="分页"
              onChange={(checked) =>
                setGptImageSettings((prev) => ({
                  ...prev,
                  [item.infiniteKey]: checked,
                }))
              }
            />
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-[#303640] pt-4">
            <span className="text-sm text-slate-400">
              {item.infinite ? '每次加载条数' : '每页显示条数'}
            </span>
            <Select
              value={item.pageSize}
              className="w-28"
              options={item.options.map((value) => ({
                value,
                label: `${value} 条`,
              }))}
              onChange={(value) =>
                setGptImageSettings((prev) => ({
                  ...prev,
                  [item.pageSizeKey]: value,
                }))
              }
            />
          </div>
        </div>
      ))}
    </div>
  )
}
