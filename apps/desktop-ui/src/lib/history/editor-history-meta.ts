import type {
  EditorHistoryItem,
  EditorHistoryOperation,
  EditorHistoryTurn,
} from '@tyco/shared'

export interface EditorHistoryMeta {
  icon: string
  labelKey: string
}

/** How an entry is shown: an AI entry leads with its result. */
export interface EditorHistoryView extends EditorHistoryMeta {
  text: string
  /** The text the AI was given, shown on demand under the result. */
  original?: { labelKey: string; text: string }
  /** The AI result was inserted into a window or copied. */
  isResultApplied: boolean
  /** The questions and answers of a quick AI request, oldest first. */
  turns?: EditorHistoryTurn[]
}

const OPERATION_ICONS: Record<EditorHistoryOperation, string> = {
  aiTask: 'mdi:robot-outline',
  translation: 'mdi:translate',
  correction: 'mdi:spellcheck',
  voiceCorrection: 'mdi:microphone-outline',
  quickAiRequest: 'mdi:auto-fix',
}

/** Label of an entry that holds the AI result. */
const RESULT_LABELS: Record<EditorHistoryOperation, string> = {
  aiTask: 'history.kindAiTask',
  translation: 'history.kindTranslate',
  correction: 'history.kindCorrection',
  voiceCorrection: 'history.kindVoiceInput',
  quickAiRequest: 'history.kindQuickAiRequest',
}

/** Label of a source the AI produced nothing from (failed or cancelled). */
const SOURCE_LABELS: Record<EditorHistoryOperation, string> = {
  aiTask: 'history.kindBeforeAiTask',
  translation: 'history.kindBeforeTranslate',
  correction: 'history.kindBeforeCorrection',
  voiceCorrection: 'history.kindVoiceTranscript',
  quickAiRequest: 'history.kindBeforeQuickAiRequest',
}

/** Icon and label that tell the user why the text is in the history. */
export function getEditorHistoryMeta(
  item: Pick<EditorHistoryItem, 'kind' | 'operation' | 'result'>
): EditorHistoryMeta {
  if (item.kind === 'output') {
    return { icon: 'mdi:application-export', labelKey: 'history.kindOutput' }
  }

  if (item.kind === 'draft') {
    return { icon: 'mdi:pencil-outline', labelKey: 'history.kindDraft' }
  }

  if (!item.operation) {
    return { icon: 'mdi:history', labelKey: 'history.kindSource' }
  }

  return {
    icon: OPERATION_ICONS[item.operation],
    labelKey: (item.result ? RESULT_LABELS : SOURCE_LABELS)[item.operation],
  }
}

export function getEditorHistoryView(
  item: Pick<EditorHistoryItem, 'kind' | 'operation' | 'result' | 'text'> &
    Partial<Pick<EditorHistoryItem, 'isResultApplied' | 'turns'>>
): EditorHistoryView {
  const meta = getEditorHistoryMeta(item)
  const turns = item.kind === 'source' && item.turns?.length ? item.turns : []

  if (item.kind !== 'source' || !item.result) {
    return {
      ...meta,
      text: item.text,
      isResultApplied: !!item.isResultApplied,
      ...(turns.length ? { turns } : {}),
    }
  }

  // a request made without a selection stores its first question as the text
  const hasSourceText = item.text.trim() !== turns[0]?.prompt.trim()

  return {
    ...meta,
    text: item.result,
    ...(hasSourceText
      ? {
          original: {
            labelKey:
              item.operation === 'voiceCorrection'
                ? 'history.originalTranscript'
                : 'history.original',
            text: item.text,
          },
        }
      : {}),
    isResultApplied: !!item.isResultApplied,
    ...(turns.length ? { turns } : {}),
  }
}
