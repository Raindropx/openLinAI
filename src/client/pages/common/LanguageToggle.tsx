import { TranslationOutlined } from '@ant-design/icons'
import { useAppLanguage } from '../../i18n'

export function LanguageToggle({
  className,
  compact = false,
}: {
  className: string
  compact?: boolean
}) {
  const { language, toggleLanguage } = useAppLanguage()
  const label = language === 'zh-CN' ? 'Switch language' : '切换语言'
  const targetLanguage = language === 'zh-CN' ? 'en-US' : 'zh-CN'

  return (
    <button
      type="button"
      className={className}
      onClick={toggleLanguage}
      title={label}
      aria-label={label}
      lang={targetLanguage}
    >
      <TranslationOutlined />
      {!compact && <span>{label}</span>}
    </button>
  )
}
