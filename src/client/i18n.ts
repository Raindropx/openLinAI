import { create } from 'zustand'
import english from './locales/en-US.json'

export type AppLanguage = 'zh-CN' | 'en-US'
const LANGUAGE_STORAGE_KEY = 'app_language'

function applyDocumentLanguage(language: AppLanguage) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  document.title =
    language === 'en-US'
      ? english['LinAI：AI 任务编排集成']
      : 'LinAI：AI 任务编排集成'
}

export type TranslationKey = keyof typeof english

export function readStoredLanguage(): AppLanguage {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en-US'
      ? 'en-US'
      : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

interface LanguageState {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
}

const useLanguageStore = create<LanguageState>((set) => ({
  language: readStoredLanguage(),
  setLanguage: (language) => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    } catch {
      // Language switching still works when browser storage is unavailable.
    }
    applyDocumentLanguage(language)
    set({ language })
  },
}))

applyDocumentLanguage(useLanguageStore.getState().language)
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) {
      const language = readStoredLanguage()
      applyDocumentLanguage(language)
      useLanguageStore.setState({ language })
    }
  })

/** UI strings only; user content and generation prompts keep their original language. */
export function t(
  key: string,
  values: readonly unknown[] = [],
  context?: string,
): string {
  const lookupKey = context ? `${key}|${context}` : key
  const translation = Object.prototype.hasOwnProperty.call(english, lookupKey)
    ? (english as Record<string, string>)[lookupKey]
    : key
  const translated =
    useLanguageStore.getState().language === 'en-US' ? translation : key
  // Replace numeric placeholders in one pass, so user text containing braces stays intact.
  return translated.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  )
}

const errorPatterns = Object.keys(english)
  .filter((key) => /\{\d+\}/.test(key) && /失败|未返回|错误/.test(key))
  .map((key) => {
    const indices: number[] = []
    const pattern = key
      .split(/(\{\d+\})/)
      .map((part) => {
        if (/^\{\d+\}$/.test(part)) {
          indices.push(Number(part.slice(1, -1)))
          return '(.*?)'
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    return { key, indices, pattern: new RegExp(`^${pattern}$`, 's') }
  })

/** Translate known application errors; preserve unrecognized provider diagnostics. */
export function translateError(message: string): string {
  if (useLanguageStore.getState().language !== 'en-US') return message
  const exact = t(message)
  if (exact !== message) return exact
  for (const { key, indices, pattern } of errorPatterns) {
    const match = pattern.exec(message)
    if (match) {
      const values: string[] = []
      indices.forEach((index, position) => {
        values[index] = match[position + 1]
      })
      return t(key, values)
    }
  }
  return message.replace(/\[(服务|配置|网络)\]/g, (prefix) => t(prefix))
}

export function useAppLanguage() {
  const { language, setLanguage } = useLanguageStore()
  return {
    language,
    t,
    toggleLanguage: () => setLanguage(language === 'zh-CN' ? 'en-US' : 'zh-CN'),
  }
}
