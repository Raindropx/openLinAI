import {
  AppstoreOutlined,
  BellOutlined,
  IdcardOutlined,
  PictureOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useEffect, useRef, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import LinpxLogo from '../../../assets/icon/linpx.png'
import { GPTImageQuota } from '../Header/GPTImageQuota'
import { openNotificationModal } from '../Notification'
import { openSettingModal } from '../SettingModal'
import { ThemeToggle } from '../ThemeToggle'

const MOBILE_BREAKPOINT = '(min-width: 1024px)'
const PULL_ACTIVATION_DISTANCE = 8
const MAX_PULL_DISTANCE = 72
const PULL_RESISTANCE = 0.56
const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/

type PullGesture = {
  identifier: number
  startX: number
  startY: number
  intent: 'pending' | 'pull' | 'other'
}

function findTouch(touches: TouchList, identifier: number) {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index)
    if (touch?.identifier === identifier) return touch
  }

  return null
}

function hasScrolledAncestor(target: Element, root: HTMLElement) {
  let element: Element | null = target

  while (element && element !== root) {
    if (element instanceof HTMLElement) {
      const { overflowY } = window.getComputedStyle(element)
      const canScroll = element.scrollHeight > element.clientHeight + 1

      if (
        canScroll &&
        SCROLLABLE_OVERFLOW.test(overflowY) &&
        element.scrollTop > 0
      ) {
        return true
      }
    }

    element = element.parentElement
  }

  return false
}

export function MobilePullBalance({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const mainScrollRoot = root.querySelector<HTMLElement>(
      '[data-mobile-scroll-root]',
    )
    if (!mainScrollRoot) return

    let gesture: PullGesture | null = null
    let settleTimer: number | undefined

    const setPullDistance = (distance: number) => {
      root.style.setProperty('--mobile-pull-distance', `${distance}px`)
      root.style.setProperty(
        '--mobile-pull-progress',
        String(Math.min(distance / 56, 1)),
      )
    }

    const settle = () => {
      if (!gesture) return

      gesture = null
      root.dataset.settling = 'true'
      setPullDistance(0)
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        delete root.dataset.settling
      }, 220)
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (
        window.matchMedia(MOBILE_BREAKPOINT).matches ||
        event.touches.length !== 1 ||
        !(event.target instanceof Element) ||
        event.target.closest(
          'button, a, input, textarea, select, [contenteditable="true"]',
        ) ||
        mainScrollRoot.scrollTop > 0 ||
        hasScrolledAncestor(event.target, root)
      ) {
        if (gesture?.intent === 'pull') {
          settle()
        } else {
          gesture = null
        }
        return
      }

      const touch = event.touches.item(0)
      if (!touch) return

      window.clearTimeout(settleTimer)
      delete root.dataset.settling
      gesture = {
        identifier: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        intent: 'pending',
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) return

      const touch = findTouch(event.touches, gesture.identifier)
      if (!touch) return

      const deltaX = touch.clientX - gesture.startX
      const deltaY = touch.clientY - gesture.startY

      if (gesture.intent === 'pending') {
        if (
          Math.max(Math.abs(deltaX), Math.abs(deltaY)) <
          PULL_ACTIVATION_DISTANCE
        ) {
          return
        }

        gesture.intent =
          deltaY > 0 && deltaY > Math.abs(deltaX) ? 'pull' : 'other'
      }

      if (gesture.intent !== 'pull') return
      if (event.cancelable) event.preventDefault()

      const distance = Math.min(
        Math.max(deltaY - PULL_ACTIVATION_DISTANCE, 0) * PULL_RESISTANCE,
        MAX_PULL_DISTANCE,
      )
      setPullDistance(distance)
    }

    root.addEventListener('touchstart', handleTouchStart, { passive: true })
    root.addEventListener('touchmove', handleTouchMove, { passive: false })
    root.addEventListener('touchend', settle, { passive: true })
    root.addEventListener('touchcancel', settle, { passive: true })

    return () => {
      window.clearTimeout(settleTimer)
      root.removeEventListener('touchstart', handleTouchStart)
      root.removeEventListener('touchmove', handleTouchMove)
      root.removeEventListener('touchend', settle)
      root.removeEventListener('touchcancel', settle)
    }
  }, [])

  return (
    <div ref={rootRef} className="mobile-pull-balance-root">
      <div className="mobile-pull-balance-drawer lg:hidden" aria-hidden="true">
        <div className="w-full max-w-md px-4">
          <GPTImageQuota variant="pull" />
        </div>
      </div>
      <div className="mobile-pull-balance-content" data-mobile-pull-content>
        {children}
      </div>
    </div>
  )
}

const navigationItems = [
  { to: '/', label: '工作台', icon: <PictureOutlined />, end: true },
  { to: '/character-card', label: '角色卡', icon: <IdcardOutlined /> },
  { to: '/templates', label: '模板', icon: <AppstoreOutlined /> },
  { to: '/tasks', label: '任务', icon: <UnorderedListOutlined /> },
]

export function MobileTopBar() {
  const navigate = useNavigate()

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#2b3039] bg-[#15181d]/95 px-3 backdrop-blur lg:hidden">
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left text-slate-100"
        onClick={() => navigate('/')}
      >
        <img
          src={LinpxLogo}
          alt="LinAI Logo"
          className="app-theme-logo h-9 w-9 rounded-lg ring-1 ring-white/8"
        />
        <span className="truncate text-sm font-semibold">LinAI 工作台</span>
      </button>
      <div className="flex items-center gap-1">
        <ThemeToggle className="mobile-header-button" />
        <button
          type="button"
          className="mobile-header-button"
          onClick={() => openNotificationModal()}
          aria-label="通知与说明"
        >
          <BellOutlined />
        </button>
        <button
          type="button"
          className="mobile-header-button"
          onClick={() => openSettingModal()}
          aria-label="设置"
        >
          <SettingOutlined />
        </button>
      </div>
    </header>
  )
}

export function MobileBottomNavigation() {
  const { pathname } = useLocation()

  return (
    <nav className="mobile-bottom-navigation lg:hidden" aria-label="主导航">
      {navigationItems.map((item) => {
        const isTemplateRoute =
          item.to === '/templates' && pathname === '/template-editor'

        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `mobile-navigation-item ${isActive || isTemplateRoute ? 'mobile-navigation-item-active' : ''}`
            }
          >
            <span className="text-xl leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
