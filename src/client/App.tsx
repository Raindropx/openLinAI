import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import pkg from '../../package.json'
import { usePopupTouchScrollGuard } from './hooks/usePopupTouchScrollGuard'
import { Header } from './pages/common/Header'
import {
  MobileBottomNavigation,
  MobilePullBalance,
  MobileTopBar,
} from './pages/common/MobileNavigation'
import { openNotificationModal } from './pages/common/Notification'
import { StudioPage } from './pages/common/Studio'
import { appRoutes } from './routes'
import { useGlobalStore } from './store/global'
import { AppThemeProvider } from './theme'

function App() {
  usePopupTouchScrollGuard()
  const { pathname } = useLocation()
  const studioActive = pathname === '/studio'
  const [studioVisited, setStudioVisited] = useState(studioActive)
  useEffect(() => {
    if (studioActive) setStudioVisited(true)
  }, [studioActive])

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
      <div className="app-shell flex h-dvh overflow-hidden bg-[#101216] font-sans text-slate-100">
        <Header />
        <MobilePullBalance disabled={studioActive}>
          <MobileTopBar />
          <main
            className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"
            data-mobile-scroll-root
          >
            {(studioVisited || studioActive) && (
              <div
                style={{
                  display: studioActive ? 'block' : 'none',
                  height: '100%',
                }}
              >
                <StudioPage active={studioActive} />
              </div>
            )}
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
        </MobilePullBalance>
      </div>
    </AppThemeProvider>
  )
}

export default App
