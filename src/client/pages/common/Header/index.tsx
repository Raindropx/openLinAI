import {
  AppstoreOutlined,
  BellOutlined,
  EditOutlined,
  GithubOutlined,
  IdcardOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PictureOutlined,
  SettingOutlined,
  ToolOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import pkg from '../../../../../package.json'
import LinpxLogo from '../../../assets/icon/linpx.png'
import LinpxSquareLogo from '../../../assets/icon/linpx2.png'
import { useAppLanguage } from '../../../i18n'
import { useAppTheme } from '../../../theme'
import { openSettingModal } from '../../common/SettingModal'
import { LanguageToggle } from '../LanguageToggle'
import { openNotificationModal } from '../Notification'
import { ThemeToggle } from '../ThemeToggle'
import { GPTImageQuota } from './GPTImageQuota'

interface NavigationItemProps {
  to: string
  icon: ReactNode
  label: string
  collapsed: boolean
  end?: boolean
}

function NavigationItem({
  to,
  icon,
  label,
  collapsed,
  end,
}: NavigationItemProps) {
  useAppLanguage()

  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        `group flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
          collapsed ? 'justify-center' : 'justify-start'
        } ${
          isActive
            ? 'app-accent-nav-active'
            : 'text-slate-400 hover:bg-[#252a32] hover:text-slate-100'
        }`
      }
    >
      <span className="text-lg">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
}

export function Header() {
  const { t } = useAppLanguage()
  const navigate = useNavigate()
  const { squareCorners } = useAppTheme()
  const [collapsed, setCollapsed] = useState(true)

  return (
    <aside
      className={`sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-[#2b3039] bg-[#15181d] shadow-[1px_0_0_rgba(255,255,255,0.02)] transition-[width] duration-200 lg:flex ${
        collapsed ? 'w-[72px]' : 'w-[216px] 2xl:w-[224px]'
      }`}
    >
      <button
        type="button"
        className={`flex h-16 shrink-0 cursor-pointer items-center gap-3 border-0 border-b border-[#2b3039] bg-transparent px-3 text-left ${
          collapsed ? 'justify-center' : 'justify-start'
        }`}
        onClick={() => navigate('/')}
        title={t('返回工作台')}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#262b33] ring-1 ring-white/8">
          <img
            src={squareCorners ? LinpxSquareLogo : LinpxLogo}
            alt="LinAI Logo"
            className="app-theme-logo h-full w-full"
          />
        </span>
        {!collapsed && (
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold tracking-wide text-slate-100">
              {t('LinAI 工作台')}
            </span>
            <span className="block text-[11px] text-slate-500">
              v{pkg.version}-ow
            </span>
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="border-b border-[#2b3039] p-3">
          <GPTImageQuota variant="sidebar" />
        </div>
      )}

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {!collapsed && (
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-[0.16em] text-slate-600">
            {t('创作工具')}
          </div>
        )}
        <NavigationItem
          to="/"
          end
          icon={<PictureOutlined />}
          label={t('图片生成')}
          collapsed={collapsed}
        />
        <NavigationItem
          to="/character-card"
          icon={<IdcardOutlined />}
          label={t('角色卡生成')}
          collapsed={collapsed}
        />
        <NavigationItem
          to="/templates"
          icon={<AppstoreOutlined />}
          label={t('模板管理')}
          collapsed={collapsed}
        />
        <NavigationItem
          to="/template-editor"
          icon={<EditOutlined />}
          label={t('模板编辑器')}
          collapsed={collapsed}
        />
        <NavigationItem
          to="/tasks"
          icon={<UnorderedListOutlined />}
          label={t('任务列表管理')}
          collapsed={collapsed}
        />
        <NavigationItem
          to="/studio"
          icon={<ToolOutlined />}
          label={t('工作室')}
          collapsed={collapsed}
        />
      </nav>

      <div className="flex shrink-0 flex-col gap-1 border-t border-[#2b3039] p-2">
        <LanguageToggle
          className={`sidebar-action-button ${collapsed ? '' : 'justify-start!'}`}
          compact={collapsed}
        />
        <ThemeToggle
          className={`sidebar-action-button ${collapsed ? '' : 'justify-start!'}`}
          showLabel={!collapsed}
        />
        <button
          type="button"
          className={`sidebar-action-button ${collapsed ? '' : 'justify-start!'}`}
          onClick={() => setCollapsed((value) => !value)}
          title={t(collapsed ? t('展开侧栏') : t('收起侧栏'))}
          aria-label={t(collapsed ? t('展开侧栏') : t('收起侧栏'))}
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          {!collapsed && <span>{t('收起侧栏')}</span>}
        </button>
        <button
          type="button"
          className={`sidebar-action-button ${collapsed ? '' : 'justify-start!'}`}
          onClick={() => openNotificationModal()}
          title={t('通知与说明')}
        >
          <BellOutlined />
          {!collapsed && <span>{t('通知与说明')}</span>}
        </button>
        <button
          type="button"
          className={`sidebar-action-button ${collapsed ? '' : 'justify-start!'}`}
          onClick={() => openSettingModal()}
          title={t('设置')}
        >
          <SettingOutlined />
          {!collapsed && <span>{t('设置')}</span>}
        </button>
        <a
          className={`sidebar-action-button ${collapsed ? '' : 'justify-start!'}`}
          href="https://github.com/Raindropx/openLinAI"
          target="_blank"
          rel="noreferrer"
          title={t('GitHub 源码')}
        >
          <GithubOutlined />
          {!collapsed && <span>{t('GitHub 源码')}</span>}
        </a>
      </div>
    </aside>
  )
}
