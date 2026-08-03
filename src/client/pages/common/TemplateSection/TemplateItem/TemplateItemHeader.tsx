import {
  DeleteOutlined,
  HolderOutlined,
  ImportOutlined,
} from '@ant-design/icons'
import { Button, message, Popconfirm, Space, Tag, Tooltip } from 'antd'
import { hc } from 'hono/client'
import type { AppType } from '../../../../../server'
import { TaskTemplate } from '../../../../../server/common/template-manager'
import { useTemplates } from '../../../../hooks/useTemplates'
import { TemplateEditButton } from './TemplateItemEditButton'

const client = hc<AppType>('/')

export const TemplateItemHeader = ({
  template,
  draggable,
  onLoad,
  clickToLoad = false,
}: {
  template: TaskTemplate
  draggable: boolean
  onLoad: (template: TaskTemplate) => void
  clickToLoad?: boolean
}) => {
  const { refresh: refreshTemplates } = useTemplates()

  const handleDelete = async (id: string) => {
    try {
      const res = await client.api.template[':id'].$delete({ param: { id } })
      const json = await res.json()
      if (json.success) {
        message.success('删除成功')
        refreshTemplates()
      } else {
        message.error(json.error || '删除失败')
      }
    } catch (error) {
      message.error('请求失败')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <Space size={4}>
          {template.aspectRatio && (
            <Tag color="blue" className="m-0">
              {template.aspectRatio}
            </Tag>
          )}
          {template.n && template.n > 1 && (
            <Tag color="cyan" className="m-0">
              {template.n}张
            </Tag>
          )}
        </Space>
        <div
          className="flex items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {!clickToLoad && (
            <Tooltip title="载入到工作区">
              <Button
                type="text"
                icon={<ImportOutlined />}
                onClick={() => {
                  onLoad(template)
                  message.success('已载入到工作区')
                }}
                className="hover:text-amber-300!"
              />
            </Tooltip>
          )}
          {!clickToLoad && <TemplateEditButton template={template} />}
          <Popconfirm
            title="确定要删除该模板吗？"
            onConfirm={() => handleDelete(template.id)}
            okButtonProps={{ danger: true }}
            placement="bottom"
          >
            <Tooltip title="删除模板">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
          {draggable && (
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/json',
                  JSON.stringify({ type: 'template', id: template.id }),
                )
                e.dataTransfer.effectAllowed = 'move'
              }}
              className="flex cursor-move items-center justify-center px-1 text-slate-500 transition-colors hover:text-slate-200"
            >
              <HolderOutlined />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
