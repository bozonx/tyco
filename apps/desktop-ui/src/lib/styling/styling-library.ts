import {
  SHORTCUT_SLOT_KEYS,
  type StylingConfig,
  type StylingsConfig,
} from '@tyco/shared'

import {
  moveShortcutSlot,
  slotList,
  slotsFromList,
} from '../shortcut-slots/shortcut-slots'

/** The text styles and the menu that shows them, `styling` of the config */
export type StylingLibrary = StylingsConfig

export function cloneStylingLibrary(library: StylingLibrary): StylingLibrary {
  return {
    ...library,
    items: library.items.map((item) => ({ ...item })),
    slots: { ...library.slots },
  }
}

export function findStyling(
  stylings: readonly StylingConfig[] | undefined,
  stylingId: string
): StylingConfig | undefined {
  return stylings?.find((item) => item.id === stylingId)
}

/** The styling presets of the menu in key order; an empty slot is `null` */
export function stylingSlotList(
  library: StylingLibrary | undefined
): (StylingConfig | null)[] {
  return slotList(library?.slots).map(
    (id) => (id && findStyling(library?.items, id)) || null
  )
}

/** Adds `item` to the library and puts it into the slot at `index` */
export function placeNewStyling(
  library: StylingLibrary,
  index: number,
  item: StylingConfig
): StylingLibrary {
  const ids = slotList(library.slots)
  ids[index] = item.id
  return {
    ...library,
    items: [...library.items, item],
    slots: slotsFromList(ids),
  }
}

/** Removes the style of the slot at `index` from the menu and the library */
export function removeStylingAt(
  library: StylingLibrary,
  index: number
): StylingLibrary {
  const itemId = library.slots[SHORTCUT_SLOT_KEYS[index]!]
  const ids = slotList(library.slots)
  ids[index] = null
  return {
    ...library,
    items: library.items.filter((item) => item.id !== itemId),
    slots: slotsFromList(ids),
  }
}

/** Moves a style to another slot of the menu */
export function moveStylingSlot(
  library: StylingLibrary,
  from: number,
  to: number
): StylingLibrary {
  return {
    ...library,
    slots: slotsFromList(moveShortcutSlot(slotList(library.slots), from, to)),
  }
}

export function updateStyling(
  library: StylingLibrary,
  stylingId: string,
  patch: Partial<Omit<StylingConfig, 'id'>>
): StylingLibrary {
  return {
    ...library,
    items: library.items.map((item) =>
      item.id === stylingId ? { ...item, ...patch } : item
    ),
  }
}

/** Drops the styles with neither a name nor a rule, with their slots */
export function withoutEmptyStylings(library: StylingLibrary): StylingLibrary {
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
