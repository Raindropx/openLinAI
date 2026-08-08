import { ConfigProvider, theme, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { PropsWithChildren } from 'react'

export const appTheme: ThemeConfig = {
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

ConfigProvider.config({
  theme: appTheme,
  holderRender: (children) => (
    <ConfigProvider locale={zhCN} theme={appTheme}>
      {children}
    </ConfigProvider>
  ),
})

export function AppThemeProvider({ children }: PropsWithChildren) {
  return (
    <ConfigProvider locale={zhCN} theme={appTheme}>
      {children}
    </ConfigProvider>
  )
}
