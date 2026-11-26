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

/** Groups saved dialogs by calendar day of when they started, newest first. */
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
    (a, b) => b.startedAt - a.startedAt || b.updatedAt - a.updatedAt
  )

  for (const item of sorted) {
    const time = item.startedAt || item.updatedAt
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

/**
 * Formats a dialog start timestamp as a clock time without seconds, respecting
 * the system locale and 12/24-hour preference (e.g., `9:03 AM` or `09:03`).
 */
export function formatDialogStartTime(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(
      epochMs
    )
  } catch {
    const date = new Date(epochMs)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
}

/**
 * Formats a dialog duration in milliseconds as human-readable localized text
 * (e.g. `5 min`, `1 hr 15 min`, `45 sec`).
 */
export function formatDialogDuration(
  durationMs: number,
  locale?: string
): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const formatUnit = (value: number, unit: 'hour' | 'minute' | 'second') => {
    try {
      return new Intl.NumberFormat(locale || undefined, {
        style: 'unit',
        unit,
        unitDisplay: 'short',
      }).format(value)
    } catch {
      const fallback = unit === 'hour' ? 'h' : unit === 'minute' ? 'min' : 's'
      return `${value} ${fallback}`
    }
  }

  if (hours > 0) {
    return minutes > 0
      ? `${formatUnit(hours, 'hour')} ${formatUnit(minutes, 'minute')}`
      : formatUnit(hours, 'hour')
  }
  if (minutes > 0) {
    return formatUnit(minutes, 'minute')
  }
  return formatUnit(seconds, 'second')
}

/**
 * Formats a session break timestamp for display in the dialog feed. For today,
 * displays the clock time (e.g. `9:30 AM` or `09:30`). For earlier days,
 * formats relative days (e.g. `yesterday at 9:30 AM` or `вчера в 9:30`).
 */
export function formatBreakTime(
  timestampMs: number,
  locale?: string,
  now = Date.now(),
  formatAt?: (date: string, time: string) => string
): string {
  const target = new Date(timestampMs)
  const nowDate = new Date(now)

  const startOfToday = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  ).getTime()
  const startOfTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime()

  const diffDays = Math.round(
    (startOfToday - startOfTarget) / (24 * 60 * 60 * 1000)
  )

  const timeStr = formatDialogStartTime(timestampMs)

  if (diffDays === 0) {
    return timeStr
  }

  let dayWord: string
  try {
    if (diffDays > 0 && diffDays <= 7) {
      dayWord = new Intl.RelativeTimeFormat(locale || undefined, {
        numeric: 'auto',
      }).format(-diffDays, 'day')
    } else {
      dayWord = new Intl.DateTimeFormat(locale || undefined, {
        dateStyle: 'medium',
      }).format(timestampMs)
    }
  } catch {
    dayWord = target.toLocaleDateString()
  }

  if (formatAt) {
    return formatAt(dayWord, timeStr)
  }

  const isRussian = locale?.toLowerCase().startsWith('ru')
  return isRussian ? `${dayWord} в ${timeStr}` : `${dayWord} at ${timeStr}`
}
