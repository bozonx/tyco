import type { InputConfigOption, SortableChecklistItem } from '../../types'

export type { SortableChecklistItem }

/**
 * Normalizes and resolves a sortable checklist configuration against defined options.
 *
 * Ensures:
 * 1. Saved order and enabled states are preserved.
 * 2. If no saved value is present, falls back to `defaultValue`.
 * 3. Any options defined in `options` that are missing from the saved/default list are appended (disabled by default).
 * 4. Stale items not in `options` are discarded.
 */
export function resolveSortableChecklist(
  saved: unknown,
  options: InputConfigOption[] = [],
  defaultValue?: unknown
): SortableChecklistItem[] {
  const optionMap = new Map<string, InputConfigOption>()
  for (const opt of options) {
    optionMap.set(String(opt.id), opt)
  }

  const rawList = parseRawList(saved) ?? parseRawList(defaultValue) ?? []
  const result: SortableChecklistItem[] = []
  const seenIds = new Set<string>()

  for (const item of rawList) {
    if (optionMap.has(item.id) && !seenIds.has(item.id)) {
      result.push({ id: item.id, enabled: item.enabled })
      seenIds.add(item.id)
    }
  }

  // Append any options not present in the list
  for (const opt of options) {
    const id = String(opt.id)
    if (!seenIds.has(id)) {
      result.push({ id, enabled: false })
      seenIds.add(id)
    }
  }

  return result
}

function parseRawList(raw: unknown): SortableChecklistItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null

  const items: SortableChecklistItem[] = []
  for (const el of raw) {
    if (typeof el === 'object' && el !== null) {
      const obj = el as Record<string, unknown>
      if ('id' in obj) {
        items.push({
          id: String(obj.id),
          enabled: obj.enabled !== false,
        })
      }
    } else if (typeof el === 'string' || typeof el === 'number') {
      items.push({
        id: String(el),
        enabled: true,
      })
    }
  }

  return items.length > 0 ? items : null
}

/**
 * Returns IDs of enabled checklist items in their current order.
 */
export function getActiveChecklistIds(
  items: SortableChecklistItem[] = []
): string[] {
  return items.filter((item) => item.enabled).map((item) => item.id)
}
