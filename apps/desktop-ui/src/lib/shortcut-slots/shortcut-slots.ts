export const SHORTCUT_SLOT_COUNT = 15

export function normalizeShortcutSlots<T>(
  items: readonly (T | null | undefined)[] | undefined
): (T | null)[] {
  return Array.from(
    { length: SHORTCUT_SLOT_COUNT },
    (_, index) => items?.[index] ?? null
  )
}

export function moveShortcutSlot<T>(
  items: readonly (T | null)[],
  from: number,
  to: number
): (T | null)[] {
  const result = normalizeShortcutSlots(items)

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
