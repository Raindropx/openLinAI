import { MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useAppLanguage } from '../../i18n'
import { useAppTheme } from '../../theme'

interface ThemeToggleProps {
  className: string
  showLabel?: boolean
}

export function ThemeToggle({
  className,
  showLabel = false,
}: ThemeToggleProps) {
  const { t } = useAppLanguage()
  const { mode, toggleTheme } = useAppTheme()
  const isDark = mode === 'dark'
  const actionLabel = t(isDark ? t('开灯') : t('关灯'))
  const accessibleLabel = t(isDark ? t('切换到明亮模式') : t('切换到黑暗模式'))

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
