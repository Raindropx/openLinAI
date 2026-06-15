import { Card, Empty, Typography } from 'antd'

interface PlaceholderTabProps {
  title: string
  description: string
}

export function PlaceholderTab({ title, description }: PlaceholderTabProps) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <div className="mb-4">
        <Typography.Title level={5} className="mb-1!">
          {title}
        </Typography.Title>
        <Typography.Text type="secondary">{description}</Typography.Text>
      </div>
      <Empty description="该区域预留给后续分类能力" />
    </Card>
  )
}
