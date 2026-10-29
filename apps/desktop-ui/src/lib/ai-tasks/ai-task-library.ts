import {
  SHORTCUT_SLOT_KEYS,
  type AiTaskConfig,
  type AiTasksConfig,
} from '@tyco/shared'

import {
  moveShortcutSlot,
  slotList,
  slotsFromList,
} from '../shortcut-slots/shortcut-slots'

/** The AI tasks and the menu that shows them, `aiTasks` of the config */
export type AiTaskLibrary = AiTasksConfig

export function cloneLibrary(library: AiTaskLibrary): AiTaskLibrary {
  return {
    ...library,
    items: library.items.map((task) => ({ ...task })),
    slots: { ...library.slots },
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
  return slotList(library?.slots).map(
    (taskId) => (taskId && findAiTask(library?.items, taskId)) || null
  )
}

/** Adds `task` to the library and puts it into the slot at `index` */
export function placeNewTask(
  library: AiTaskLibrary,
  index: number,
  task: AiTaskConfig
): AiTaskLibrary {
  const ids = slotList(library.slots)
  ids[index] = task.id
  return {
    ...library,
    items: [...library.items, task],
    slots: slotsFromList(ids),
  }
}

/** Removes the task of the slot at `index` from the menu and the library */
export function removeTaskAt(
  library: AiTaskLibrary,
  index: number
): AiTaskLibrary {
  const taskId = library.slots[SHORTCUT_SLOT_KEYS[index]!]
  const ids = slotList(library.slots)
  ids[index] = null
  return {
    ...library,
    items: library.items.filter((task) => task.id !== taskId),
    slots: slotsFromList(ids),
  }
}

/** Moves a task to another slot of the menu */
export function moveTaskSlot(
  library: AiTaskLibrary,
  from: number,
  to: number
): AiTaskLibrary {
  return {
    ...library,
    slots: slotsFromList(moveShortcutSlot(slotList(library.slots), from, to)),
  }
}

export function updateAiTask(
  library: AiTaskLibrary,
  taskId: string,
  patch: Partial<Omit<AiTaskConfig, 'id'>>
): AiTaskLibrary {
  return {
    ...library,
    items: library.items.map((task) =>
      task.id === taskId ? { ...task, ...patch } : task
    ),
  }
}

/** Drops the tasks with neither a name nor a prompt, with their slots */
export function withoutEmptyTasks(library: AiTaskLibrary): AiTaskLibrary {
  const kept = library.items.filter((task) =>
    Boolean(task.name?.trim() || task.prompt?.trim())
  )
  const ids = new Set(kept.map((task) => task.id))
  return {
    ...library,
    items: kept,
    slots: slotsFromList(
      slotList(library.slots).map((id) => (id && ids.has(id) ? id : null))
    ),
  }
}
