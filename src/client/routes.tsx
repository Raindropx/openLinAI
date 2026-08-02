import { CharacterCardPage } from './pages/common/CharacterCard'
import { Home } from './pages/common/Home'
import { TaskManagementPage } from './pages/common/TaskManagement'
import { TemplateEditorPage } from './pages/common/TemplateEditor'
import { TemplateManagementPage } from './pages/common/TemplateManagement'

export const appRoutes = [
  {
    path: '/',
    label: '工作台',
    element: <Home />,
    key: 'home',
  },
  {
    path: '/character-card',
    label: '角色卡生成',
    element: <CharacterCardPage />,
    key: 'character-card',
  },
  {
    path: '/templates',
    label: '模板管理',
    element: <TemplateManagementPage />,
    key: 'templates',
  },
  {
    path: '/template-editor',
    label: '模板编辑器',
    element: <TemplateEditorPage />,
    key: 'template-editor',
  },
  {
    path: '/tasks',
    label: '任务列表管理',
    element: <TaskManagementPage />,
    key: 'tasks',
  },
]
