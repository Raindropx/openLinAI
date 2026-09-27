import { t } from './i18n'
import { CharacterCardPage } from './pages/common/CharacterCard'
import { Home } from './pages/common/Home'
import { TaskManagementPage } from './pages/common/TaskManagement'
import { TemplateEditorPage } from './pages/common/TemplateEditor'
import { TemplateManagementPage } from './pages/common/TemplateManagement'

export const appRoutes = [
  {
    path: '/',
    get label() {
      return t('工作台')
    },
    element: <Home />,
    key: 'home',
  },
  {
    path: '/character-card',
    get label() {
      return t('角色卡生成')
    },
    element: <CharacterCardPage />,
    key: 'character-card',
  },
  {
    path: '/templates',
    get label() {
      return t('模板管理')
    },
    element: <TemplateManagementPage />,
    key: 'templates',
  },
  {
    path: '/template-editor',
    get label() {
      return t('模板编辑器')
    },
    element: <TemplateEditorPage />,
    key: 'template-editor',
  },
  {
    path: '/tasks',
    get label() {
      return t('任务列表管理')
    },
    element: <TaskManagementPage />,
    key: 'tasks',
  },
  {
    path: '/studio',
    get label() {
      return t('工作室')
    },
    element: null,
    key: 'studio',
  },
]
