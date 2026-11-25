import type { DialogSummary } from '@tyco/shared'

export type DialogHistoryGroup =
  'today' | 'yesterday' | 'previousWeek' | 'older'

/**
 * Dialogs matching the search query. Until backend full-text search answers,
 * matches against title and preview.
 */
export function filterDialogHistory(
  items: readonly DialogSummary[],
  query: string,
  matchedIds?: ReadonlySet<string> | null
): DialogSummary[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...items]
  return items.filter(
    (item) =>
      matchedIds?.has(item.id) ||
      item.title.toLowerCase().includes(normalized) ||
      item.preview.toLowerCase().includes(normalized)
  )
}

/** Groups saved dialogs by calendar day of their last update, newest first. */
export function groupDialogHistory(
  items: readonly DialogSummary[],
  now = Date.now()
): Array<{ key: DialogHistoryGroup; items: DialogSummary[] }> {
  const startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  const startYesterday = new Date(startToday)
  startYesterday.setDate(startYesterday.getDate() - 1)
  const startWeek = new Date(startToday)
  startWeek.setDate(startWeek.getDate() - 7)

  const groups = new Map<DialogHistoryGroup, DialogSummary[]>()
  const sorted = [...items].sort(
    (a, b) => b.updatedAt - a.updatedAt || b.startedAt - a.startedAt
  )

  for (const item of sorted) {
    const time = item.updatedAt || item.startedAt
    const key: DialogHistoryGroup =
      time >= startToday.getTime()
        ? 'today'
        : time >= startYesterday.getTime()
          ? 'yesterday'
          : time >= startWeek.getTime()
            ? 'previousWeek'
            : 'older'
    const group = groups.get(key) || []
    group.push(item)
    groups.set(key, group)
  }

  return (['today', 'yesterday', 'previousWeek', 'older'] as const)
    .filter((key) => groups.has(key))
    .map((key) => ({ key, items: groups.get(key) || [] }))
}

/** Formats a dialog duration in milliseconds as `M:SS` or `H:MM:SS`. */
export function formatDialogDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`
}
