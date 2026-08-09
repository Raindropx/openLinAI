import { SearchOutlined, SortAscendingOutlined } from '@ant-design/icons'
import { Input, Select } from 'antd'
import type { ReactNode } from 'react'

export type ListSortMode =
  | 'default'
  | 'time-asc'
  | 'time-desc'
  | 'title-asc'
  | 'title-desc'

export const LIST_SORT_OPTIONS = [
  { value: 'default', label: '默认排序' },
  { value: 'time-asc', label: '时间顺序' },
  { value: 'time-desc', label: '时间倒序' },
  { value: 'title-asc', label: '首字母顺序' },
  { value: 'title-desc', label: '首字母倒序' },
] satisfies Array<{ value: ListSortMode; label: string }>

export function sortListItems<T>(
  items: T[],
  mode: ListSortMode,
  options: {
    getTime: (item: T) => number
    getTitle: (item: T) => string
    defaultCompare?: (a: T, b: T) => number
  },
) {
  const nextItems = [...items]
  const compareTitle = (a: T, b: T) =>
    options.getTitle(a).localeCompare(options.getTitle(b), 'zh-CN', {
      numeric: true,
      sensitivity: 'base',
    })

  switch (mode) {
    case 'time-asc':
      return nextItems.sort((a, b) => options.getTime(a) - options.getTime(b))
    case 'time-desc':
      return nextItems.sort((a, b) => options.getTime(b) - options.getTime(a))
    case 'title-asc':
      return nextItems.sort(compareTitle)
    case 'title-desc':
      return nextItems.sort((a, b) => compareTitle(b, a))
    default:
      return options.defaultCompare
        ? nextItems.sort(options.defaultCompare)
        : nextItems
  }
}

interface ListToolbarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  sortMode: ListSortMode
  onSortChange: (value: ListSortMode) => void
  searchPlaceholder: string
  compact?: boolean
  fluidSortOnMobile?: boolean
  actions?: ReactNode
}

export function ListToolbar({
  searchValue,
  onSearchChange,
  sortMode,
  onSortChange,
  searchPlaceholder,
  compact = false,
  fluidSortOnMobile = false,
  actions,
}: ListToolbarProps) {
  return (
    <div
      className={`flex gap-2 ${
        compact ? 'flex-col' : 'flex-col lg:flex-row lg:items-center'
      }`}
    >
      <Input
        allowClear
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        prefix={<SearchOutlined className="text-slate-500" />}
        placeholder={searchPlaceholder}
        className="min-w-0 flex-1"
      />
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <Select<ListSortMode>
          value={sortMode}
          onChange={onSortChange}
          options={LIST_SORT_OPTIONS}
          suffixIcon={<SortAscendingOutlined />}
          className={
            compact || fluidSortOnMobile
              ? `min-w-0 flex-1 ${fluidSortOnMobile ? 'sm:w-36 sm:flex-none' : ''}`
              : 'w-36 shrink-0'
          }
          popupMatchSelectWidth={false}
        />
        {actions}
      </div>
    </div>
  )
}
