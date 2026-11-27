import type { EditorHistoryItem, EditorHistoryOrigin } from '@tyco/shared'

/**
 * What the history list shows: every entry, entries of one source or kind, or
 * the problem ones. `all` includes entries without a source.
 */
export type HistoryFilter =
  | 'all'
  | EditorHistoryOrigin
  | 'voiceCommands'
  | 'translation'
  | 'aiTask'
  | 'problems'

export const HISTORY_FILTERS: readonly HistoryFilter[] = [
  'all',
  'quickInput',
  'voice',
  'voiceCommands',
  'listen',
  'quickAiRequest',
  'translation',
  'aiTask',
  'externalRun',
  'commandRun',
  'problems',
]

export const DEFAULT_HISTORY_FILTER: HistoryFilter = 'all'

/** Whether the entry was created by the voice commands overlay */
export function isVoiceCommandHistoryItem(
  item: Pick<EditorHistoryItem, 'instruction'>
): boolean {
  return item.instruction?.inputKind === 'voice'
}

/**
 * A text that may be what the user lost: a draft, or the source of an AI
 * operation that failed, was cancelled, or whose result was not inserted or
 * copied
 */
export function isProblemHistoryItem(
  item: Pick<
    EditorHistoryItem,
    'kind' | 'isResultApplied' | 'origin' | 'failure'
  >
): boolean {
  if (item.origin === 'externalRun' || item.origin === 'commandRun')
    return Boolean(item.failure)
  return (
    item.kind === 'draft' || (item.kind === 'source' && !item.isResultApplied)
  )
}

export function filterEditorHistory<
  T extends Pick<
    EditorHistoryItem,
    | 'kind'
    | 'isResultApplied'
    | 'origin'
    | 'operation'
    | 'instruction'
    | 'failure'
  >,
>(items: readonly T[], filter: HistoryFilter): T[] {
  switch (filter) {
    case 'all':
      return [...items]
    case 'problems':
      return items.filter(isProblemHistoryItem)
    case 'voice':
      return items.filter(
        (item) => item.origin === 'voice' && !isVoiceCommandHistoryItem(item)
      )
    case 'voiceCommands':
      return items.filter(isVoiceCommandHistoryItem)
    case 'translation':
      return items.filter((item) => item.operation === 'translation')
    case 'aiTask':
      return items.filter((item) => item.operation === 'aiTask')
    default:
      return items.filter((item) => item.origin === filter)
  }
}
