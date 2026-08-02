import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileTextOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import {
  Button,
  Empty,
  Image,
  Input,
  Popconfirm,
  Spin,
  Tag,
  Tooltip,
} from 'antd'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import type { StoredCharacterCard } from '../../../../server/common/character-card-manager'

interface CharacterCardLibraryProps {
  cards: StoredCharacterCard[]
  loading: boolean
  activeId?: string | null
  onLoad: (card: StoredCharacterCard) => void
  onDelete: (card: StoredCharacterCard) => void
  onExport: (card: StoredCharacterCard) => void
}

export function CharacterCardLibrary({
  cards,
  loading,
  activeId,
  onLoad,
  onDelete,
  onExport,
}: CharacterCardLibraryProps) {
  const [keyword, setKeyword] = useState('')
  const visibleCards = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return cards
    return cards.filter((card) =>
      [card.name, card.format].some((value) =>
        value.toLocaleLowerCase('zh-CN').includes(normalized),
      ),
    )
  }, [cards, keyword])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[#303640] p-3">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索角色名或格式"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spin />
          </div>
        ) : visibleCards.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={keyword ? '没有匹配的角色卡' : '暂无已保存角色卡'}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visibleCards.map((item) => {
              const active = item.id === activeId
              return (
                <article
                  key={item.id}
                  className={`overflow-hidden rounded-lg border bg-[#1a1e24] transition-colors ${
                    active
                      ? 'border-amber-400/70 shadow-[0_0_0_1px_rgba(241,184,75,0.18)]'
                      : 'border-[#343a44] hover:border-[#4a5361]'
                  }`}
                >
                  <div className="relative aspect-[2/3] overflow-hidden bg-[#111318]">
                    {item.format === 'png' && item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.name}
                        classNames={{
                          root: 'h-full! w-full!',
                          image: 'h-full! w-full! object-cover',
                        }}
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.12),transparent_65%)] text-sky-300/75">
                        <FileTextOutlined className="text-5xl" />
                        <span className="text-xs tracking-[0.2em]">JSON</span>
                      </div>
                    )}

                    <div className="absolute top-2 left-2 z-10">
                      <Tooltip title="载入到角色卡工作区">
                        <Button
                          type="primary"
                          shape="circle"
                          size="small"
                          icon={<ArrowLeftOutlined />}
                          onClick={() => onLoad(item)}
                        />
                      </Tooltip>
                    </div>
                    <div className="absolute top-2 right-2 z-10 flex gap-1">
                      <Tooltip title="导出角色卡">
                        <Button
                          shape="circle"
                          size="small"
                          icon={<DownloadOutlined />}
                          className="border-white/15! bg-black/60! text-white!"
                          onClick={() => onExport(item)}
                        />
                      </Tooltip>
                      <Popconfirm
                        title={`删除“${item.name}”？`}
                        description="仅删除角色卡库中的副本。"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => onDelete(item)}
                      >
                        <Button
                          danger
                          shape="circle"
                          size="small"
                          icon={<DeleteOutlined />}
                          className="border-white/15! bg-black/60!"
                        />
                      </Popconfirm>
                    </div>
                  </div>

                  <div className="p-2.5">
                    <div className="truncate text-sm font-medium text-slate-100">
                      {item.name || '未命名角色'}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <Tag
                        color={item.format === 'png' ? 'purple' : 'blue'}
                        className="m-0! text-[10px]!"
                      >
                        {item.format.toUpperCase()}
                      </Tag>
                      <span className="truncate text-[10px] text-slate-500">
                        {dayjs(item.updatedAt).format('MM/DD HH:mm')}
                      </span>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
