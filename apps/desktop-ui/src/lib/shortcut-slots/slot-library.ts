import { SHORTCUT_SLOT_KEYS, type ShortcutSlots } from '@tyco/shared'

import { moveShortcutSlot, slotList, slotsFromList } from './shortcut-slots'
import {
  firstFreeSlotIndex,
  nameFromPrompt,
  nextNumberedId,
} from './slot-prompt'

/** A named rule of a library shown in a shortcut menu */
export interface SlotLibraryItem {
  id: string
  name: string
  rule: string
}

/** Rules and the shortcut menu that shows them, by id */
export interface SlotLibrary<T extends SlotLibraryItem> {
  items: T[]
  slots: ShortcutSlots<string>
}

/** What saving an own request did to the library */
export type SavePromptOutcome = 'added' | 'placed' | 'exists' | 'full'

export interface SavePromptResult<L> {
  /** The library to store; unchanged for `exists` and `full` */
  library: L
  outcome: SavePromptOutcome
}

export function cloneSlotLibrary<
  T extends SlotLibraryItem,
  L extends SlotLibrary<T>,
>(library: L): L {
  return {
    ...library,
    items: library.items.map((item) => ({ ...item })),
    slots: { ...library.slots },
  }
}

export function findSlotItem<T extends SlotLibraryItem>(
  items: readonly T[] | undefined,
  id: string
): T | undefined {
  return items?.find((item) => item.id === id)
}

/** The items of the menu in key order; an empty slot is `null` */
export function slotItemList<T extends SlotLibraryItem>(
  library: SlotLibrary<T> | undefined
): (T | null)[] {
  return slotList(library?.slots).map(
    (id) => (id && findSlotItem(library?.items, id)) || null
  )
}

/** The name a menu shows for an item: its name, or the start of its rule */
export function slotItemLabel(item: SlotLibraryItem): string {
  return item.name.trim() || nameFromPrompt(item.rule)
}

/** Adds `item` to the library and puts it into the slot at `index` */
export function placeNewSlotItem<
  T extends SlotLibraryItem,
  L extends SlotLibrary<T>,
>(library: L, index: number, item: T): L {
  const ids = slotList(library.slots)
  ids[index] = item.id
  return {
    ...library,
    items: [...library.items, item],
    slots: slotsFromList(ids),
  }
}

/** Removes the item of the slot at `index` from the menu and the library */
export function removeSlotItemAt<
  T extends SlotLibraryItem,
  L extends SlotLibrary<T>,
>(library: L, index: number): L {
  const itemId = library.slots[SHORTCUT_SLOT_KEYS[index]!]
  const ids = slotList(library.slots)
  ids[index] = null
  return {
    ...library,
    items: library.items.filter((item) => item.id !== itemId),
    slots: slotsFromList(ids),
  }
}

/** Moves an item to another slot of the menu */
export function moveSlotItem<
  T extends SlotLibraryItem,
  L extends SlotLibrary<T>,
>(library: L, from: number, to: number): L {
  return {
    ...library,
    slots: slotsFromList(moveShortcutSlot(slotList(library.slots), from, to)),
  }
}

export function updateSlotItem<
  T extends SlotLibraryItem,
  L extends SlotLibrary<T>,
>(library: L, id: string, patch: Partial<Omit<T, 'id'>>): L {
  return {
    ...library,
    items: library.items.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    ),
  }
}

/** Drops the items with neither a name nor a rule, with their slots */
export function withoutEmptySlotItems<
  T extends SlotLibraryItem,
  L extends SlotLibrary<T>,
>(library: L): L {
  const kept = library.items.filter(
    (item) => item.name.trim() || item.rule.trim()
  )
  const ids = new Set(kept.map((item) => item.id))
  return {
    ...library,
    items: kept,
    slots: Object.fromEntries(
      Object.entries(library.slots).filter(([, id]) => id && ids.has(id))
    ),
  }
}

/**
 * Saves `prompt` as a new item in the first free slot. A request saved already
 * is not added twice: it only gets a free slot when it has none
 */
export function savePromptToSlotLibrary<
  T extends SlotLibraryItem,
  L extends SlotLibrary<T>,
>(library: L, prompt: string, idPrefix: string): SavePromptResult<L> | null {
  const rule = prompt.trim()
  if (!rule) return null

  const index = firstFreeSlotIndex(library.slots)
  const existing = library.items.find((item) => item.rule.trim() === rule)
  if (existing) {
    const isShown = Object.values(library.slots).includes(existing.id)
    if (isShown) return { library, outcome: 'exists' }
    if (index < 0) return { library, outcome: 'full' }
    const ids = slotList(library.slots)
    ids[index] = existing.id
    return {
      library: { ...library, slots: slotsFromList(ids) },
      outcome: 'placed',
    }
  }

  if (index < 0) return { library, outcome: 'full' }
  return {
    library: placeNewSlotItem<T, L>(library, index, {
      id: nextNumberedId(library.items, idPrefix),
      name: nameFromPrompt(rule),
      rule,
    } as T),
    outcome: 'added',
  }
}
