export type TaskStatus = 'Backlog' | 'Ready' | 'In progress' | 'In review' | 'Done'
export type ProjectTask = {
  id: number
  title: string
  assignee: string
  timeline: string
  notes: string
  createdBy: string
  updatedBy: string
  status: TaskStatus
}
export type ProjectItem = { id: number; name: string; tasks: ProjectTask[] }
export type Workspace = { projects: ProjectItem[]; selectedProjectId: number | null; reminders: ReminderItem[] }
export const statuses: TaskStatus[] = ['Backlog', 'Ready', 'In progress', 'In review', 'Done']
export function isProjects(value: unknown): value is ProjectItem[] {
  if (!Array.isArray(value) || value.length > 50) return false
  const ids = new Set<number>()
  const validId = (id: unknown) => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || ids.has(id)) return false
    ids.add(id)
    return true
  }
  return value.every((project) => project && validId(project.id) && typeof project.name === 'string'
    && project.name.trim().length > 0 && Array.isArray(project.tasks) && project.tasks.length <= 200
    && project.tasks.every((task: ProjectTask) => task && validId(task.id)
      && ['title', 'assignee', 'timeline', 'notes', 'createdBy', 'updatedBy'].every((key) => typeof task[key as keyof ProjectTask] === 'string')
      && task.title.trim().length > 0 && statuses.includes(task.status)))
}
export function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== 'object') return false
  const record = value as Workspace
  return isProjects(record.projects) && isReminders(record.reminders) && !record.reminders.some((r) => record.projects.some((p) => p.id === r.id || p.tasks.some((t) => t.id === r.id))) && (record.selectedProjectId === null || record.projects.some((p) => p.id === record.selectedProjectId))
}

export type ReminderItem = { id: number; title: string; dueAt: string; notes: string; status: 'pending' | 'done' }
export function isReminders(value: unknown): value is ReminderItem[] {
  if (!Array.isArray(value) || value.length > 200) return false
  const ids = new Set<number>()
  return value.every((item) => {
    if (!item || !Number.isSafeInteger(item.id) || ids.has(item.id) || typeof item.title !== 'string' || !item.title.trim()
      || typeof item.dueAt !== 'string' || !Number.isFinite(Date.parse(item.dueAt)) || typeof item.notes !== 'string'
      || !['pending', 'done'].includes(item.status)) return false
    ids.add(item.id)
    return true
  })
}

export function formatTimeline(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
