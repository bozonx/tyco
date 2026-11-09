import type { EditorHistoryItem, EditorHistoryOrigin } from '@tyco/shared'

/**
 * What the history list shows: every entry, entries of one source, or the
 * problem ones. `all` includes entries without a source.
 */
export type HistoryFilter = 'all' | EditorHistoryOrigin | 'problems'

export const HISTORY_FILTERS: readonly HistoryFilter[] = [
  'all',
  'quickInput',
  'voice',
  'listen',
  'quickAiRequest',
  'problems',
]

export const DEFAULT_HISTORY_FILTER: HistoryFilter = 'all'

/**
 * A text that may be what the user lost: a draft, or the source of an AI
 * operation that failed, was cancelled, or whose result was not inserted or
 * copied
 */
export function isProblemHistoryItem(
  item: Pick<EditorHistoryItem, 'kind' | 'isResultApplied'>
): boolean {
  return (
    item.kind === 'draft' || (item.kind === 'source' && !item.isResultApplied)
  )
}

export function filterEditorHistory<
  T extends Pick<EditorHistoryItem, 'kind' | 'isResultApplied' | 'origin'>,
>(items: readonly T[], filter: HistoryFilter): T[] {
  if (filter === 'all') return [...items]
  if (filter === 'problems') return items.filter(isProblemHistoryItem)
  return items.filter((item) => item.origin === filter)
}
