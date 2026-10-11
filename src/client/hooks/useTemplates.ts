import type { TaskTemplate } from '../../server/common/template-manager'
import { createResourceCache, resourceData } from '../service/resources'

const templates = createResourceCache('templates', [] as TaskTemplate[], () => resourceData<TaskTemplate[]>('/api/template'))
export function useTemplates({ manual = false }: { manual?: boolean } = {}) {
  const state = templates.useCache(!manual)
  return { ...state, run: state.refresh, runAsync: async () => { await state.refreshAsync(); return templates.getState().data } }
}
