import { SHORTCUT_SLOT_KEYS, type ShortcutSlots } from '@tyco/shared'

export const SHORTCUT_SLOT_COUNT = SHORTCUT_SLOT_KEYS.length

/** The slots of a grid in key order, an empty one as `null` */
export function slotList<T>(
  slots: ShortcutSlots<T> | null | undefined
): (T | null)[] {
  return SHORTCUT_SLOT_KEYS.map((key) => slots?.[key] ?? null)
}

/** A grid of the slots in key order; `null` leaves a slot empty */
export function slotsFromList<T>(
  items: readonly (T | null | undefined)[]
): ShortcutSlots<T> {
  const slots: ShortcutSlots<T> = {}
  SHORTCUT_SLOT_KEYS.forEach((key, index) => {
    const item = items[index]
    if (item !== null && item !== undefined) slots[key] = item
  })
  return slots
}

export function moveShortcutSlot<T>(
  items: readonly (T | null)[],
  from: number,
  to: number
): (T | null)[] {
  const result = Array.from(
    { length: SHORTCUT_SLOT_COUNT },
    (_, index) => items[index] ?? null
  )

  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= result.length ||
    to >= result.length ||
    from === to ||
    result[from] === null
  )
    return result

  ;[result[from], result[to]] = [result[to], result[from]]
  return result
}
