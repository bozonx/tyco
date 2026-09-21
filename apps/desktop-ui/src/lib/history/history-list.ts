import type { EditorHistoryItem, EditorHistoryKind } from '@tyco/shared'

export type EditorHistoryFilter = 'all' | EditorHistoryKind

export function filterEditorHistory(
  items: EditorHistoryItem[],
  filter: EditorHistoryFilter
): EditorHistoryItem[] {
  if (filter === 'all') return items

  return items.filter((item) => item.kind === filter)
}

export interface HistoryDayGroup<T> {
  key: string
  /** Either an i18n key (today, yesterday, unknown time) or a ready label. */
  labelKey?: string
  label?: string
  items: T[]
}

const UNKNOWN_DAY = 'unknown'

function dayKey(time: number): string {
  const date = new Date(time)

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** `locale` is an app locale like `en_US`; falls back to the system one. */
function formatWith(
  time: number,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  try {
    return new Intl.DateTimeFormat(locale.replace('_', '-'), options).format(
      time
    )
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(time)
  }
}

/**
 * Splits a newest-first list into local calendar days. Entries without a known
 * time (legacy ones) end up in a group of their own
 */
export function groupByDay<T>(
  items: T[],
  getTime: (item: T) => number,
  now: number,
  locale: string
): HistoryDayGroup<T>[] {
  const today = dayKey(now)
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = dayKey(yesterdayDate.getTime())
  const groups = new Map<string, HistoryDayGroup<T>>()

  for (const item of items) {
    const time = getTime(item)
    const key = time > 0 ? dayKey(time) : UNKNOWN_DAY
    let group = groups.get(key)

    if (!group) {
      group = { key, items: [] }

      if (key === UNKNOWN_DAY) group.labelKey = 'history.earlier'
      else if (key === today) group.labelKey = 'history.today'
      else if (key === yesterday) group.labelKey = 'history.yesterday'
      else group.label = formatWith(time, locale, { dateStyle: 'medium' })

      groups.set(key, group)
    }

    group.items.push(item)
  }

  return [...groups.values()]
}

/** Local time of an entry; empty when the time is unknown. */
export function formatHistoryTime(time: number, locale: string): string {
  if (!(time > 0)) return ''

  return formatWith(time, locale, { timeStyle: 'short' })
}

/** Full local date and time, suitable for a compact timestamp tooltip. */
export function formatHistoryDateTime(time: number, locale: string): string {
  if (!(time > 0)) return ''

  return formatWith(time, locale, { dateStyle: 'long', timeStyle: 'medium' })
}

/** Unix time in milliseconds of an ISO date; 0 when it cannot be parsed. */
export function parseHistoryTime(isoDate: string | undefined): number {
  const time = isoDate ? Date.parse(isoDate) : NaN

  return Number.isFinite(time) ? time : 0
}
