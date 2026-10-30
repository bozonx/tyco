import {
  firstFreeSlotIndex,
  nameFromPrompt,
  nextNumberedId,
} from '../shortcut-slots/slot-prompt'
import {
  cloneLibrary,
  placeNewTask,
  type AiTaskLibrary,
} from './ai-task-library'

export type { AiTaskConfig } from '@tyco/shared'

/** An id no task has yet: `task-<n>` */
export const newAiTaskId = (
  items: readonly ({ id?: unknown } | null | undefined)[]
): string => nextNumberedId(items, 'task')

/** A short name of a task saved from an own request: its first line, cut */
export const taskNameFromPrompt = nameFromPrompt

/**
 * The task library with `prompt` saved as a task in the first free slot, or
 * null when all slots are taken. A request already saved as a task is not added
 * twice: the library comes back unchanged.
 */
export function addTaskFromPrompt(
  library: AiTaskLibrary,
  prompt: string
): AiTaskLibrary | null {
  const cleanPrompt = prompt.trim()

  if (!cleanPrompt) return null
  if (library.items.some((task) => task.prompt?.trim() === cleanPrompt))
    return cloneLibrary(library)

  const index = firstFreeSlotIndex(library.slots)
  if (index < 0) return null

  return placeNewTask(library, index, {
    id: newAiTaskId(library.items),
    name: taskNameFromPrompt(cleanPrompt),
    prompt: cleanPrompt,
    allowedTools: [],
    outputAction: 'replace',
    maxSteps: 5,
  })
}
