import { TaskList } from '../TaskList'

export function TaskManagementPage() {
  return (
    <div className="min-h-full p-2 sm:p-3 lg:p-4">
      <TaskList variant="management" />
    </div>
  )
}
