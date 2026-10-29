import {
  SHORTCUT_SLOT_KEYS,
  type TransformationConfig,
  type TransformationsConfig,
} from '@tyco/shared'

import {
  moveShortcutSlot,
  slotList,
  slotsFromList,
} from '../shortcut-slots/shortcut-slots'

/**
 * The text transformations and the menu that shows them, `transformations` of
 * the config
 */
export type TransformationLibrary = TransformationsConfig

export function cloneTransformationLibrary(
  library: TransformationLibrary
): TransformationLibrary {
  return {
    ...library,
    items: library.items.map((task) => ({ ...task })),
    slots: { ...library.slots },
  }
}

export function findTransformation(
  transformations: readonly TransformationConfig[] | undefined,
  transformationId: string
): TransformationConfig | undefined {
  return transformations?.find((item) => item.id === transformationId)
}

/** The transformations of the menu in key order; an empty slot is `null` */
export function transformationSlotList(
  library: TransformationLibrary | undefined
): (TransformationConfig | null)[] {
  return slotList(library?.slots).map(
    (id) => (id && findTransformation(library?.items, id)) || null
  )
}

/** Adds `item` to the library and puts it into the slot at `index` */
export function placeNewTransformation(
  library: TransformationLibrary,
  index: number,
  item: TransformationConfig
): TransformationLibrary {
  const ids = slotList(library.slots)
  ids[index] = item.id
  return {
    ...library,
    items: [...library.items, item],
    slots: slotsFromList(ids),
  }
}

/**
 * Removes the transformation of the slot at `index` from the menu and the
 * library
 */
export function removeTransformationAt(
  library: TransformationLibrary,
  index: number
): TransformationLibrary {
  const itemId = library.slots[SHORTCUT_SLOT_KEYS[index]!]
  const ids = slotList(library.slots)
  ids[index] = null
  return {
    ...library,
    items: library.items.filter((item) => item.id !== itemId),
    slots: slotsFromList(ids),
  }
}

/** Moves a transformation to another slot of the menu */
export function moveTransformationSlot(
  library: TransformationLibrary,
  from: number,
  to: number
): TransformationLibrary {
  return {
    ...library,
    slots: slotsFromList(moveShortcutSlot(slotList(library.slots), from, to)),
  }
}

export function updateTransformation(
  library: TransformationLibrary,
  transformationId: string,
  patch: Partial<Omit<TransformationConfig, 'id'>>
): TransformationLibrary {
  return {
    ...library,
    items: library.items.map((item) =>
      item.id === transformationId ? { ...item, ...patch } : item
    ),
  }
}

/** Drops the transformations with neither a name nor a rule, with their slots */
export function withoutEmptyTransformations(
  library: TransformationLibrary
): TransformationLibrary {
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
