import { MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useAppTheme } from '../../theme'

interface ThemeToggleProps {
  className: string
  showLabel?: boolean
}

export function ThemeToggle({ className, showLabel = false }: ThemeToggleProps) {
  const { mode, toggleTheme } = useAppTheme()
  const isDark = mode === 'dark'
  const actionLabel = isDark ? '开灯' : '关灯'
  const accessibleLabel = isDark ? '切换到明亮模式' : '切换到黑暗模式'

  return (
    <button
      type="button"
      className={className}
      onClick={toggleTheme}
      title={accessibleLabel}
      aria-label={accessibleLabel}
      aria-pressed={!isDark}
    >
      {isDark ? <SunOutlined /> : <MoonOutlined />}
      {showLabel && <span>{actionLabel}</span>}
    </button>
  )
}
