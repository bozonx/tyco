import {
  SHORTCUT_SLOT_KEYS,
  type AiTaskConfig,
  type UserConfig,
} from '@tyco/shared'

import {
  moveShortcutSlot,
  slotList,
  slotsFromList,
} from '../shortcut-slots/shortcut-slots'

/** The AI tasks and the menu that shows them, as the config holds them */
export type AiTaskLibrary = Pick<UserConfig, 'aiTasks' | 'aiTaskSlots'>

export function cloneLibrary(library: AiTaskLibrary): AiTaskLibrary {
  return {
    aiTasks: library.aiTasks.map((task) => ({ ...task })),
    aiTaskSlots: { ...library.aiTaskSlots },
  }
}

export function findAiTask(
  tasks: readonly AiTaskConfig[] | undefined,
  taskId: string
): AiTaskConfig | undefined {
  return tasks?.find((task) => task.id === taskId)
}

/** The tasks of the menu in key order; an empty slot is `null` */
export function taskSlotList(
  library: AiTaskLibrary | undefined
): (AiTaskConfig | null)[] {
  return slotList(library?.aiTaskSlots).map(
    (taskId) => (taskId && findAiTask(library?.aiTasks, taskId)) || null
  )
}

/** Adds `task` to the library and puts it into the slot at `index` */
export function placeNewTask(
  library: AiTaskLibrary,
  index: number,
  task: AiTaskConfig
): AiTaskLibrary {
  const ids = slotList(library.aiTaskSlots)
  ids[index] = task.id
  return {
    aiTasks: [...library.aiTasks, task],
    aiTaskSlots: slotsFromList(ids),
  }
}

/** Removes the task of the slot at `index` from the menu and the library */
export function removeTaskAt(
  library: AiTaskLibrary,
  index: number
): AiTaskLibrary {
  const taskId = library.aiTaskSlots[SHORTCUT_SLOT_KEYS[index]!]
  const ids = slotList(library.aiTaskSlots)
  ids[index] = null
  return {
    aiTasks: library.aiTasks.filter((task) => task.id !== taskId),
    aiTaskSlots: slotsFromList(ids),
  }
}

/** Moves a task to another slot of the menu */
export function moveTaskSlot(
  library: AiTaskLibrary,
  from: number,
  to: number
): AiTaskLibrary {
  return {
    aiTasks: library.aiTasks,
    aiTaskSlots: slotsFromList(
      moveShortcutSlot(slotList(library.aiTaskSlots), from, to)
    ),
  }
}

export function updateAiTask(
  library: AiTaskLibrary,
  taskId: string,
  patch: Partial<Omit<AiTaskConfig, 'id'>>
): AiTaskLibrary {
  return {
    aiTasks: library.aiTasks.map((task) =>
      task.id === taskId ? { ...task, ...patch } : task
    ),
    aiTaskSlots: library.aiTaskSlots,
  }
}

/** Drops the tasks with neither a name nor a rule, with their slots */
export function withoutEmptyTasks(library: AiTaskLibrary): AiTaskLibrary {
  const kept = library.aiTasks.filter(
    (task) => task.name.trim() || task.rule.trim()
  )
  const ids = new Set(kept.map((task) => task.id))
  return {
    aiTasks: kept,
    aiTaskSlots: slotsFromList(
      slotList(library.aiTaskSlots).map((id) => (id && ids.has(id) ? id : null))
    ),
  }
}
