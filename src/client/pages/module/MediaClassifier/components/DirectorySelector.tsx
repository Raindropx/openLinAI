import {
  FolderOpenOutlined,
  SaveOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { Button, Card, Input, Space, Typography } from 'antd'
import type { MediaWorkspaceSnapshot, MediaWorkspaceKind } from '../types'

interface DirectorySelectorProps {
  sourceDir: string
  resultDir: string
  workspace: MediaWorkspaceSnapshot | null
  saving: boolean
  pickingKind: MediaWorkspaceKind | null
  onSourceDirChange: (value: string) => void
  onResultDirChange: (value: string) => void
  onPickFolder: (kind: MediaWorkspaceKind) => void
  onSave: () => void
}

const summaryItems = [
  { key: 'originalCount', label: '原始图片' },
  { key: 'pendingCount', label: '待筛选' },
  { key: 'screenedCount', label: '已保留' },
  { key: 'trashCount', label: '回收站' },
] as const

export function DirectorySelector({
  sourceDir,
  resultDir,
  workspace,
  saving,
  pickingKind,
  onSourceDirChange,
  onResultDirChange,
  onPickFolder,
  onSave,
}: DirectorySelectorProps) {
  return (
    <Card
      className="border-slate-200 shadow-sm"
      classNames={{ body: 'space-y-4 p-4! md:p-6!' }}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <Typography.Title level={4} className="mb-1!">
            图片整理
          </Typography.Title>
          <Typography.Text type="secondary">
            选择源目录和结果目录后，即可开始快速筛图。保留的图片会同步到结果目录。
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={onSave}
        >
          应用目录
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <Typography.Text strong>源图片文件夹</Typography.Text>
            <Button
              icon={<FolderOpenOutlined />}
              loading={pickingKind === 'source'}
              onClick={() => onPickFolder('source')}
            >
              选择
            </Button>
          </div>
          <Input
            value={sourceDir}
            onChange={(event) => onSourceDirChange(event.target.value)}
            placeholder="请选择或输入源图片文件夹绝对路径"
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <Typography.Text strong>结果文件夹</Typography.Text>
            <Button
              icon={<FolderOpenOutlined />}
              loading={pickingKind === 'result'}
              onClick={() => onPickFolder('result')}
            >
              选择
            </Button>
          </div>
          <Input
            value={resultDir}
            onChange={(event) => onResultDirChange(event.target.value)}
            placeholder="请选择或输入结果文件夹绝对路径"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryItems.map((item) => (
          <div
            key={item.key}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <Typography.Text type="secondary">{item.label}</Typography.Text>
            <div className="mt-2 text-2xl font-semibold text-slate-800">
              {workspace?.summary[item.key] ?? 0}
            </div>
          </div>
        ))}
      </div>

      <Space size={8} className="text-slate-500">
        <SyncOutlined />
        <Typography.Text type="secondary">
          当前仅实现原始图片筛选、回收站和筛选后展示，分类后的图片页先保留结构。
        </Typography.Text>
      </Space>
    </Card>
  )
}
