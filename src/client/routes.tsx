import { Home } from './pages/common/Home'
import { CharacterCardPage } from './pages/common/CharacterCard'

export const appRoutes = [
  {
    path: '/',
    label: '首页',
    element: <Home />,
    key: 'home',
  },
  {
    path: '/character-card',
    label: '角色卡生成',
    element: <CharacterCardPage />,
    key: 'character-card',
  },
]
