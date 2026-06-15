import { SaveOutlined } from '@ant-design/icons'
import { Button, Card, Input, Typography } from 'antd'

interface DirectorySelectorProps {
  sourceDir: string
  resultDir: string
  saving: boolean
  onSourceDirChange: (value: string) => void
  onResultDirChange: (value: string) => void
  onSave: () => void
}

export function DirectorySelector({
  sourceDir,
  resultDir,
  saving,
  onSourceDirChange,
  onResultDirChange,
  onSave,
}: DirectorySelectorProps) {
  return (
    <div className="flex min-h-[calc(100vh-240px)] items-center justify-center">
      <Card
        className="w-full max-w-xl border-slate-200 shadow-sm"
        classNames={{ body: 'space-y-6 p-6! md:p-8!' }}
      >
        <div className="text-center">
          <Typography.Title level={3} className="mb-0!">
            图片整理
          </Typography.Title>
          <Typography.Text type="secondary">
            请先输入源图片文件夹和结果文件夹的绝对路径，保存后再进入筛图流程。
          </Typography.Text>
        </div>

        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Typography.Text strong>源图片文件夹</Typography.Text>
            <Input
              value={sourceDir}
              onChange={(event) => onSourceDirChange(event.target.value)}
              placeholder="请输入源图片文件夹绝对路径"
              size="large"
            />
          </div>

          <div className="space-y-2">
            <Typography.Text strong>结果文件夹</Typography.Text>
            <Input
              value={resultDir}
              onChange={(event) => onResultDirChange(event.target.value)}
              placeholder="请输入结果文件夹绝对路径"
              size="large"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="primary"
            size="large"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={onSave}
          >
            保存目录
          </Button>
        </div>
      </Card>
    </div>
  )
}
