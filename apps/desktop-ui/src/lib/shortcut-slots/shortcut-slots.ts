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

  if (from === to || !result[from]) return result

  ;[result[from], result[to]] = [result[to], result[from]]
  return result
}
