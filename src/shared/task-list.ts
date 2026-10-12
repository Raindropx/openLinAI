import type { Task } from '../server/common/task-manager'
import { TRIAL_TEMPLATE_TITLE } from '../server/common/template-manager/enum'

export interface TaskListActions {
  addToTemplate: boolean
  refill: boolean
  retry: boolean
}

/** Determine available actions from the full record before removing snapshots. */
export function taskListActions(task: Task): TaskListActions {
  if (task.summaryOnly && task.listActions) return task.listActions
  const provenance = task.studioProvenance
  return {
    addToTemplate: Boolean(task.rawTemplate && (!provenance || provenance.template)),
    refill: Boolean(task.rawTemplate && (!provenance || provenance.template || provenance.novelai)),
    retry: Boolean(
      (!provenance || provenance.novelai) &&
      (task.endpointName !== 'NovelAI Studio' || task.novelaiSnapshots?.length || provenance?.novelai) &&
      task.rawTemplate?.title !== TRIAL_TEMPLATE_TITLE,
    ),
  }
}
