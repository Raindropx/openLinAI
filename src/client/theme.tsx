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
const ACCENT_STORAGE_KEY = 'app_theme_accent'
const THEME_CHANGE_EVENT = 'app-theme-change'

export const DEFAULT_ACCENT_COLOR = '#f1b84b'

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

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
  accentColor: string
  toggleTheme: () => void
  setAccentColor: (color: string) => void
  resetAccentColor: () => void
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

function normalizeAccentColor(color: string) {
  return HEX_COLOR_PATTERN.test(color)
    ? color.toLowerCase()
    : DEFAULT_ACCENT_COLOR
}

function readStoredAccentColor() {
  if (typeof window === 'undefined') return DEFAULT_ACCENT_COLOR

  try {
    return normalizeAccentColor(
      window.localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT_COLOR,
    )
  } catch {
    return DEFAULT_ACCENT_COLOR
  }
}

function hexToRgb(color: string) {
  const value = Number.parseInt(color.slice(1), 16)

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function rgbToHex({ r, g, b }: ReturnType<typeof hexToRgb>) {
  return `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`
}

function mixColors(color: string, target: string, ratio: number) {
  const sourceRgb = hexToRgb(color)
  const targetRgb = hexToRgb(target)

  return rgbToHex({
    r: sourceRgb.r + (targetRgb.r - sourceRgb.r) * ratio,
    g: sourceRgb.g + (targetRgb.g - sourceRgb.g) * ratio,
    b: sourceRgb.b + (targetRgb.b - sourceRgb.b) * ratio,
  })
}

function getColorHue(color: string) {
  const { r, g, b } = hexToRgb(color)
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum

  if (delta === 0) return null

  let hue: number
  if (maximum === red) {
    hue = ((green - blue) / delta) % 6
  } else if (maximum === green) {
    hue = (blue - red) / delta + 2
  } else {
    hue = (red - green) / delta + 4
  }

  return (hue * 60 + 360) % 360
}

function getLogoHueRotation(accentColor: string) {
  const defaultHue = getColorHue(DEFAULT_ACCENT_COLOR) ?? 0
  const accentHue = getColorHue(accentColor)

  if (accentHue === null) return 0

  return ((accentHue - defaultHue + 540) % 360) - 180
}

function relativeLuminance(color: string) {
  const channels = Object.values(hexToRgb(color)).map((channel) => {
    const value = channel / 255
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4)
  })

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrastRatio(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function ensureAccentContrast(
  color: string,
  background: string,
  target: string,
) {
  if (contrastRatio(color, background) >= 4.5) return color

  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixColors(color, target, step / 20)
    if (contrastRatio(candidate, background) >= 4.5) return candidate
  }

  return target
}

function resolveAccentColor(mode: AppThemeMode, accentColor: string) {
  if (accentColor === DEFAULT_ACCENT_COLOR) {
    return mode === 'dark' ? DEFAULT_ACCENT_COLOR : '#a96812'
  }

  return mode === 'dark'
    ? ensureAccentContrast(accentColor, '#1a1e24', '#ffffff')
    : ensureAccentContrast(accentColor, '#ffffff', '#000000')
}

function getThemeConfig(mode: AppThemeMode, accentColor: string): ThemeConfig {
  const baseTheme = mode === 'light' ? lightAppTheme : darkAppTheme
  const resolvedAccentColor = resolveAccentColor(mode, accentColor)

  return {
    ...baseTheme,
    token: {
      ...baseTheme.token,
      colorPrimary: resolvedAccentColor,
      colorInfo: resolvedAccentColor,
    },
  }
}

function applyDocumentTheme(mode: AppThemeMode, accentColor: string) {
  if (typeof document === 'undefined') return

  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
  document.documentElement.style.setProperty(
    '--app-accent',
    resolveAccentColor(mode, accentColor),
  )
  document.documentElement.style.setProperty(
    '--app-logo-hue-rotate',
    `${getLogoHueRotation(accentColor)}deg`,
  )
}

function configureStaticTheme(mode: AppThemeMode, accentColor: string) {
  const themeConfig = getThemeConfig(mode, accentColor)

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
const initialAccentColor = readStoredAccentColor()
applyDocumentTheme(initialTheme, initialAccentColor)
configureStaticTheme(initialTheme, initialAccentColor)

export function AppThemeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<AppThemeMode>(readStoredTheme)
  const [accentColor, setAccentColorState] = useState(readStoredAccentColor)
  const themeConfig = useMemo(
    () => getThemeConfig(mode, accentColor),
    [accentColor, mode],
  )
  const contextValue = useMemo<AppThemeContextValue>(
    () => ({
      mode,
      accentColor,
      toggleTheme: () => {
        const nextMode = mode === 'dark' ? 'light' : 'dark'
        setMode(nextMode)
        window.dispatchEvent(
          new CustomEvent(THEME_CHANGE_EVENT, {
            detail: { mode: nextMode },
          }),
        )
      },
      setAccentColor: (color) => {
        const normalizedColor = normalizeAccentColor(color)
        setAccentColorState(normalizedColor)
        window.dispatchEvent(
          new CustomEvent(THEME_CHANGE_EVENT, {
            detail: { accentColor: normalizedColor },
          }),
        )
      },
      resetAccentColor: () => {
        setAccentColorState(DEFAULT_ACCENT_COLOR)
        window.dispatchEvent(
          new CustomEvent(THEME_CHANGE_EVENT, {
            detail: { accentColor: DEFAULT_ACCENT_COLOR },
          }),
        )
      },
    }),
    [accentColor, mode],
  )

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          mode?: AppThemeMode
          accentColor?: string
        }>
      ).detail

      if (detail?.mode) setMode(detail.mode)
      if (detail?.accentColor) {
        setAccentColorState(normalizeAccentColor(detail.accentColor))
      }
    }
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) setMode(readStoredTheme())
      if (event.key === ACCENT_STORAGE_KEY) {
        setAccentColorState(readStoredAccentColor())
      }
    }

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange)
    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  useEffect(() => {
    applyDocumentTheme(mode, accentColor)
    configureStaticTheme(mode, accentColor)

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode)
      window.localStorage.setItem(ACCENT_STORAGE_KEY, accentColor)
    } catch {
      // 存储不可用时仍允许当前页面切换主题。
    }
  }, [accentColor, mode])

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
