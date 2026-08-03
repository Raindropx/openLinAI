import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import pkg from '../../package.json'
import { Header } from './pages/common/Header'
import {
  MobileBottomNavigation,
  MobileTopBar,
} from './pages/common/MobileNavigation'
import { openNotificationModal } from './pages/common/Notification'
import { appRoutes } from './routes'
import { useGlobalStore } from './store/global'
import { AppThemeProvider } from './theme'

function App() {
  useEffect(() => {
    useGlobalStore.getState().fetchConfig()

    // 检查版本号并弹出通知
    const currentVersion = pkg.version
    const storedVersion = localStorage.getItem('app_version')
    if (storedVersion !== currentVersion) {
      openNotificationModal()
      localStorage.setItem('app_version', currentVersion)
    }
  }, [])

  return (
    <AppThemeProvider>
      <div className="flex h-dvh overflow-hidden bg-[#101216] font-sans text-slate-100">
        <Header />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MobileTopBar />
          <main className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
            <Routes>
              {appRoutes.map((route) => (
                <Route
                  key={route.key}
                  path={route.path}
                  element={route.element}
                />
              ))}
            </Routes>
          </main>
          <MobileBottomNavigation />
        </div>
      </div>
    </AppThemeProvider>
  )
}

export default App
