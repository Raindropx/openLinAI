import {
  AppstoreOutlined,
  BellOutlined,
  IdcardOutlined,
  PictureOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import LinpxLogo from '../../../assets/icon/linpx.png'
import { openNotificationModal } from '../Notification'
import { openSettingModal } from '../SettingModal'

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
          className="h-9 w-9 rounded-lg ring-1 ring-white/8"
        />
        <span className="truncate text-sm font-semibold">LinAI 工作台</span>
      </button>
      <div className="flex items-center gap-1">
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
