import { ClockCircleOutlined } from '@ant-design/icons'
import { Tag, Tooltip } from 'antd'
import type { Task } from '../../../../../server/common/task-manager'
import { usePlatform } from '../../../../hooks/usePlatform'
import {
  estimateImageCost,
  formatImageCost,
  formatImageUsd,
  formatImageUsdLabel,
} from '../../../../utils/imageCost'

interface TaskItemTagsProps {
  task: Task
  downloadedIds: string[]
  compact?: boolean
  showEndpoint?: boolean
}

export function TaskItemTags({
  task,
  downloadedIds,
  compact = false,
  showEndpoint = true,
}: TaskItemTagsProps) {
  const { isDesktop } = usePlatform()

  const renderCost = (record: Task) => {
    const bill = record.imageBilling
    if (
      bill?.status === 'actual' &&
      typeof bill.cost === 'number' &&
      Number.isFinite(bill.cost) &&
      bill.cost >= 0
    ) {
      return (
        <Tooltip
          title={
            <div>
              <div>
                实际费用: {formatImageCost(bill.cost, bill.currency)}
              </div>
              {bill.quota !== undefined && (
                <div>扣费点数: {bill.quota.toLocaleString()}</div>
              )}
              {bill.entries?.map((entry) => (
                <div key={entry.requestId}>
                  分组: {entry.group || '未提供'}
                  {entry.groupRatio !== undefined
                    ? ` · 倍率 ${entry.groupRatio}`
                    : ''}
                </div>
              ))}
              <div>
                {bill.source === 'provider-response'
                  ? '来自本次请求的服务商响应，已包含服务商计费调整'
                  : '来自本次请求的消费日志，已包含分组倍率及上游计费调整'}
              </div>
            </div>
          }
        >
          <Tag color="gold" style={{ cursor: 'help' }}>
            实际{formatImageCost(bill.cost, bill.currency, true)}
          </Tag>
        </Tooltip>
      )
    }
    if (
      bill?.status === 'estimated' &&
      typeof bill.cost === 'number' &&
      Number.isFinite(bill.cost) &&
      bill.cost >= 0
    ) {
      return (
        <Tooltip
          title={
            <div>
              <div>
                预估费用: {formatImageCost(bill.cost, bill.currency)}
              </div>
              {bill.note && <div>{bill.note}</div>}
              <div>实际费用以服务商账单为准</div>
            </div>
          }
        >
          <Tag color="gold" style={{ cursor: 'help' }}>
            约{formatImageCost(bill.cost, bill.currency, true)}
          </Tag>
        </Tooltip>
      )
    }
    const suppressLegacyEstimate =
      /pollinations|dragonapi|novelai|venice|openrouter/i.test(
        record.endpointName || '',
      )
    if (bill?.status === 'unavailable' || suppressLegacyEstimate) return null
    if (record.gptTokenUsage) {
      const inputTokens = record.gptTokenUsage.input_tokens || 0
      const outputTokens = record.gptTokenUsage.output_tokens || 0
      const estimate = estimateImageCost(
        record.source,
        inputTokens,
        outputTokens,
        bill?.estimatedGroupRatio,
      )
      if (!estimate) return null
      const inputCost = estimate.input
      const outputCost = estimate.output
      const totalCost = inputCost + outputCost
      const cost2str = formatImageUsd
      const tooltipContent = (
        <div>
          <div>输入 tokens: {inputTokens}</div>
          <div>输入预估费用: {cost2str(inputCost)}</div>
          <div>输出 tokens: {outputTokens}</div>
          <div>输出预估费用: {cost2str(outputCost)}</div>
          <div>
            {bill?.status === 'pending'
              ? '正在查询实际账单'
              : '未取得可匹配的实际账单'}
          </div>
          {bill?.estimatedGroupRatio !== undefined ? (
            <div>
              已包含配置的分组倍率 {bill.estimatedGroupRatio}
              ，未包含图片输入差价及其他计费调整
            </div>
          ) : (
            <div>
              美元基准估算，分组倍率按 1
              计算，未包含图片输入差价及其他计费调整
            </div>
          )}
          <div>实际费用以服务商账单为准</div>
        </div>
      )

      return (
        <Tooltip title={tooltipContent}>
          <Tag color="gold" style={{ cursor: 'help' }}>
            约{formatImageUsdLabel(totalCost)}
          </Tag>
        </Tooltip>
      )
    }
    return bill?.status === 'pending' ? <Tag>费用查询中</Tag> : null
  }

  return (
    <div
      className={`${compact ? 'mb-1' : 'mb-2'} flex flex-wrap gap-1 [&_.ant-tag]:m-0!`}
    >
      {task.rawTemplate?.aspectRatio && (
        <Tag color="blue">{task.rawTemplate.aspectRatio}</Tag>
      )}
      {task.size && (
        <Tooltip
          title="该尺寸仅为输入时设置的尺寸，实际会受到模型最大像素限制、比例调整和分组分辨率可用性，以实际图片比例为准"
          className="cursor-pointer"
        >
          <Tag color="magenta">{task.size}</Tag>
        </Tooltip>
      )}
      {task.quality && (
        <Tag color={task.quality === 'high' ? 'red' : 'volcano'}>
          {task.quality === 'high' ? 'H' : 'M'}
        </Tag>
      )}
      {downloadedIds?.includes(task.id) ? (
        <Tag color="cyan">已下载</Tag>
      ) : (
        <Tag color="geekblue">未下载</Tag>
      )}
      {isDesktop && renderCost(task)}
      {isDesktop && task.duration && (
        <Tag color="lime">
          <ClockCircleOutlined className="mr-1" />
          {(task.duration / 1000).toFixed(1)}s
        </Tag>
      )}
      {showEndpoint && (
        <Tooltip title={task.endpointName || '未记录端点'}>
          <Tag color="purple" className="max-w-full truncate">
            {task.endpointName || '未知端点'}
          </Tag>
        </Tooltip>
      )}
    </div>
  )
}
