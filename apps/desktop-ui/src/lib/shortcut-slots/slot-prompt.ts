import { SHORTCUT_SLOT_KEYS, type ShortcutSlotKey } from '@tyco/shared'

const NAME_LIMIT = 32

type MaybeIdentified = { id?: unknown } | null | undefined

/** An id none of `items` has yet: `<prefix>-<n>` */
export function nextNumberedId(
  items: readonly MaybeIdentified[],
  prefix: string
): string {
  const used = new Set(
    items.flatMap((item) =>
      typeof item?.id === 'string' && item.id.trim() !== '' ? [item.id] : []
    )
  )
  let n = 1
  while (used.has(`${prefix}-${n}`)) n += 1
  return `${prefix}-${n}`
}

/** A short name of an item saved from an own request: its first line, cut */
export function nameFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0]?.trim() ?? ''
  if (firstLine.length <= NAME_LIMIT) return firstLine
  return `${firstLine.slice(0, NAME_LIMIT - 1).trimEnd()}…`
}

/** The index of the first empty shortcut slot, or -1 when all are taken */
export function firstFreeSlotIndex(
  slots: Partial<Record<ShortcutSlotKey, unknown>>
): number {
  return SHORTCUT_SLOT_KEYS.findIndex((key) => !slots[key])
}
