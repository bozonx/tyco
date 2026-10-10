/** An AI task of the user config: a named rule applied to the text */
export interface AiTaskConfig {
  /** Stable and hidden: what the main menu refers to the task by */
  id: string
  name: string
  rule: string
  tapAction?: string
  holdAction?: string
}

export type AiTaskSlots = readonly (AiTaskConfig | null)[]

const TASK_NAME_LIMIT = 32

const hasId = (task: { id?: unknown } | null): boolean =>
  typeof task?.id === 'string' && task.id.trim() !== ''

/**
 * An id no task has yet: `task-<n>`, as the backend gives the tasks that have
 * none when it loads the config
 */
export function newAiTaskId(
  tasks: readonly ({ id?: unknown } | null)[]
): string {
  const used = new Set(tasks.map((task) => (hasId(task) ? task!.id : null)))
  let n = 1
  while (used.has(`task-${n}`)) n += 1
  return `task-${n}`
}

/** The tasks, each with an id; a task that has one keeps it */
export function withAiTaskIds<T extends { id?: unknown }>(
  tasks: readonly (T | null)[]
): ((T & { id: string }) | null)[] {
  const next: ((T & { id: string }) | null)[] = []
  for (const [index, task] of tasks.entries()) {
    if (!task || hasId(task)) {
      next.push(task as (T & { id: string }) | null)
      continue
    }
    // ids of the tasks after this one are taken as well
    next.push({ ...task, id: newAiTaskId([...next, ...tasks.slice(index)]) })
  }
  return next
}

/** A short name of a task saved from an own request: its first line, cut */
export function taskNameFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0]?.trim() ?? ''

  if (firstLine.length <= TASK_NAME_LIMIT) return firstLine

  return `${firstLine.slice(0, TASK_NAME_LIMIT - 1).trimEnd()}…`
}

/**
 * The AI tasks with `prompt` saved in the first free slot, or null when all
 * `slotCount` slots are taken. A request already saved as a task is not added
 * twice: the tasks come back unchanged.
 */
export function addTaskFromPrompt(
  tasks: AiTaskSlots,
  prompt: string,
  slotCount: number
): (AiTaskConfig | null)[] | null {
  const rule = prompt.trim()

  if (!rule) return null
  if (tasks.some((task) => task?.rule.trim() === rule)) return [...tasks]

  const next = [...tasks]
  const free = next.findIndex((task) => !task || !task.name)
  const task = { id: newAiTaskId(next), name: taskNameFromPrompt(rule), rule }

  if (free >= 0) {
    next[free] = task
    return next
  }

  if (next.length >= slotCount) return null

  next.push(task)
  return next
}
