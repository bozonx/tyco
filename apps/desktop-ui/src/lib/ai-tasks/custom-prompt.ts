import {
  SHORTCUT_SLOT_KEYS,
  type AiTaskConfig,
  type ShortcutSlots,
} from '@tyco/shared'

export type { AiTaskConfig } from '@tyco/shared'

const TASK_NAME_LIMIT = 32

const hasId = (task: { id?: unknown } | null | undefined): boolean =>
  typeof task?.id === 'string' && task.id.trim() !== ''

/** An id no task has yet: `task-<n>` */
export function newAiTaskId(
  tasks: readonly ({ id?: unknown } | null | undefined)[]
): string {
  const used = new Set(tasks.map((task) => (hasId(task) ? task!.id : null)))
  let n = 1
  while (used.has(`task-${n}`)) n += 1
  return `task-${n}`
}

/** A short name of a task saved from an own request: its first line, cut */
export function taskNameFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0]?.trim() ?? ''

  if (firstLine.length <= TASK_NAME_LIMIT) return firstLine

  return `${firstLine.slice(0, TASK_NAME_LIMIT - 1).trimEnd()}…`
}

/**
 * The AI tasks with `prompt` saved in the first free slot, or null when all
 * slots are taken. A request already saved as a task is not added twice: the
 * tasks come back unchanged.
 */
export function addTaskFromPrompt(
  tasks: ShortcutSlots<AiTaskConfig>,
  prompt: string
): ShortcutSlots<AiTaskConfig> | null {
  const rule = prompt.trim()

  if (!rule) return null
  const saved = Object.values(tasks)
  if (saved.some((task) => task.rule.trim() === rule)) return { ...tasks }

  const free = SHORTCUT_SLOT_KEYS.find((key) => !tasks[key]?.name)
  if (!free) return null

  return {
    ...tasks,
    [free]: { id: newAiTaskId(saved), name: taskNameFromPrompt(rule), rule },
  }
}
