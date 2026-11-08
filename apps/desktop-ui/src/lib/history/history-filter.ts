import type { EditorHistoryItem, EditorHistoryOrigin } from '@tyco/shared'

/** The source the history list shows; `all` includes entries without one */
export type HistoryOriginFilter = 'all' | EditorHistoryOrigin

export const HISTORY_ORIGIN_FILTERS: readonly HistoryOriginFilter[] = [
  'all',
  'quickInput',
  'voice',
  'quickAiRequest',
]

export interface HistoryFilter {
  origin: HistoryOriginFilter
  /** Only texts that never left the app: they may be what the user lost */
  isUnsentOnly: boolean
}

export const DEFAULT_HISTORY_FILTER: HistoryFilter = {
  origin: 'all',
  isUnsentOnly: false,
}

/**
 * A text that never left the app: a draft, or the source of an AI operation
 * whose result was not inserted or copied
 */
export function isUnsentHistoryItem(
  item: Pick<EditorHistoryItem, 'kind' | 'isResultApplied'>
): boolean {
  return (
    item.kind === 'draft' || (item.kind === 'source' && !item.isResultApplied)
  )
}

export function filterEditorHistory<
  T extends Pick<EditorHistoryItem, 'kind' | 'isResultApplied' | 'origin'>,
>(items: readonly T[], filter: HistoryFilter): T[] {
  return items.filter(
    (item) =>
      (filter.origin === 'all' || item.origin === filter.origin) &&
      (!filter.isUnsentOnly || isUnsentHistoryItem(item))
  )
}
