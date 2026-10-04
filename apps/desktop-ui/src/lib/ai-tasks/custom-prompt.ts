/** An AI task of the user config: a named rule applied to the text */
export interface AiTaskConfig {
  name: string
  rule: string
  tapAction?: string
  holdAction?: string
}

export type AiTaskSlots = readonly (AiTaskConfig | null)[]

const TASK_NAME_LIMIT = 32

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
  const task = { name: taskNameFromPrompt(rule), rule }

  if (free >= 0) {
    next[free] = task
    return next
  }

  if (next.length >= slotCount) return null

  next.push(task)
  return next
}
