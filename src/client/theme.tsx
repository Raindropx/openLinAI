import { ConfigProvider, theme, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

export type AppThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'app_theme'

const darkAppTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#f1b84b',
    colorInfo: '#f1b84b',
    colorBgBase: '#101216',
    colorBgContainer: '#1a1e24',
    colorBgElevated: '#20252d',
    colorBorder: '#343a44',
    colorText: '#edf1f7',
    colorTextSecondary: '#9ba6b5',
    colorWarning: '#e4ad3a',
    colorWarningBg: '#302712',
    colorWarningBorder: '#6b5226',
    colorWarningText: '#f3d58a',
    borderRadius: 8,
    borderRadiusLG: 12,
  },
  components: {
    Button: {
      primaryShadow: 'none',
    },
    Card: {
      colorBgContainer: '#1a1e24',
    },
    Segmented: {
      itemSelectedBg: '#343b46',
    },
    Tooltip: {
      maxWidth: 500,
    },
  },
}

const lightAppTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#a96812',
    colorInfo: '#a96812',
    colorBgBase: '#f4f6f9',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorder: '#d8dee7',
    colorText: '#1f2937',
    colorTextSecondary: '#667085',
    colorWarning: '#b7791f',
    colorWarningBg: '#fff8e6',
    colorWarningBorder: '#e7bf72',
    colorWarningText: '#7a4b0b',
    borderRadius: 8,
    borderRadiusLG: 12,
  },
  components: {
    Button: {
      primaryShadow: 'none',
    },
    Card: {
      colorBgContainer: '#ffffff',
    },
    Segmented: {
      itemSelectedBg: '#ffffff',
    },
    Tooltip: {
      maxWidth: 500,
    },
  },
}

type AppThemeContextValue = {
  mode: AppThemeMode
  toggleTheme: () => void
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null)

function readStoredTheme(): AppThemeMode {
  if (typeof window === 'undefined') return 'dark'

  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light'
      ? 'light'
      : 'dark'
  } catch {
    return 'dark'
  }
}

function getThemeConfig(mode: AppThemeMode) {
  return mode === 'light' ? lightAppTheme : darkAppTheme
}

function applyDocumentTheme(mode: AppThemeMode) {
  if (typeof document === 'undefined') return

  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
}

function configureStaticTheme(mode: AppThemeMode) {
  const themeConfig = getThemeConfig(mode)

  ConfigProvider.config({
    theme: themeConfig,
    holderRender: (children) => (
      <ConfigProvider locale={zhCN} theme={themeConfig}>
        {children}
      </ConfigProvider>
    ),
  })
}

const initialTheme = readStoredTheme()
applyDocumentTheme(initialTheme)
configureStaticTheme(initialTheme)

export function AppThemeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<AppThemeMode>(readStoredTheme)
  const themeConfig = getThemeConfig(mode)
  const contextValue = useMemo<AppThemeContextValue>(
    () => ({
      mode,
      toggleTheme: () =>
        setMode((currentMode) =>
          currentMode === 'dark' ? 'light' : 'dark',
        ),
    }),
    [mode],
  )

  useEffect(() => {
    applyDocumentTheme(mode)
    configureStaticTheme(mode)

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode)
    } catch {
      // 存储不可用时仍允许当前页面切换主题。
    }
  }, [mode])

  return (
    <AppThemeContext.Provider value={contextValue}>
      <ConfigProvider locale={zhCN} theme={themeConfig}>
        {children}
      </ConfigProvider>
    </AppThemeContext.Provider>
  )
}

export function useAppTheme() {
  const context = useContext(AppThemeContext)

  if (!context) {
    throw new Error('useAppTheme must be used within AppThemeProvider')
  }

  return context
}
