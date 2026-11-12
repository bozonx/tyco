import type {
  EditorHistoryFailureKind,
  EditorHistoryItem,
  EditorHistoryOperation,
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
}

const OPERATION_ICONS: Record<EditorHistoryOperation, string> = {
  aiTask: 'mdi:robot-outline',
  translation: 'mdi:translate',
  correction: 'mdi:spellcheck',
  voiceCorrection: 'mdi:microphone-outline',
}

/** Label of an entry that holds the AI result. */
const RESULT_LABELS: Record<EditorHistoryOperation, string> = {
  aiTask: 'history.kindAiTask',
  translation: 'history.kindTranslate',
  correction: 'history.kindCorrection',
  voiceCorrection: 'history.kindVoiceInput',
}

/** Label of a source the AI produced nothing from (failed or cancelled). */
const SOURCE_LABELS: Record<EditorHistoryOperation, string> = {
  aiTask: 'history.kindBeforeAiTask',
  translation: 'history.kindBeforeTranslate',
  correction: 'history.kindBeforeCorrection',
  voiceCorrection: 'history.kindVoiceTranscript',
}

/** Icon and label that tell the user why the text is in the history. */
export function getEditorHistoryMeta(
  item: Pick<EditorHistoryItem, 'kind' | 'operation' | 'result'> &
    Partial<Pick<EditorHistoryItem, 'origin'>>
): EditorHistoryMeta {
  if (item.kind === 'output') {
    // the conversation itself is kept with the chats
    return item.origin === 'quickAiRequest'
      ? { icon: 'mdi:auto-fix', labelKey: 'history.kindQuickAiRequestOutput' }
      : { icon: 'mdi:application-export', labelKey: 'history.kindOutput' }
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
    Partial<Pick<EditorHistoryItem, 'isResultApplied' | 'origin'>>
): EditorHistoryView {
  const meta = getEditorHistoryMeta(item)

  if (item.kind !== 'source' || !item.result) {
    return { ...meta, text: item.text, isResultApplied: !!item.isResultApplied }
  }

  return {
    ...meta,
    text: item.result,
    original: {
      labelKey:
        item.operation === 'voiceCorrection'
          ? 'history.originalTranscript'
          : 'history.original',
      text: item.text,
    },
    isResultApplied: !!item.isResultApplied,
  }
}

export type HistoryNoteTone = 'success' | 'error' | 'muted'

export interface EditorHistoryNote {
  labelKey: string
  tone: HistoryNoteTone
  icon?: string
  /** The error the user was shown when the AI operation failed */
  detail?: string
}

const FAILURE_LABELS: Record<EditorHistoryFailureKind, string> = {
  error: 'history.requestFailed',
  timeout: 'history.requestTimedOut',
  cancelled: 'history.requestCancelled',
}

/**
 * Note and status indicator for an entry. Normally sent items have no
 * badge/checkmark. Failed or interrupted items are marked in red.
 */
export function getEditorHistoryNote(
  item: Pick<EditorHistoryItem, 'kind' | 'operation' | 'result'> &
    Partial<Pick<EditorHistoryItem, 'isResultApplied' | 'failure'>>
): EditorHistoryNote | undefined {
  if (item.kind === 'output' || item.isResultApplied) {
    return undefined
  }

  if (item.kind === 'draft') {
    return {
      labelKey: 'history.interrupted',
      tone: 'error',
      icon: 'mdi:alert-circle-outline',
    }
  }

  if (item.kind === 'source') {
    if (!item.result && item.failure) {
      return {
        labelKey: FAILURE_LABELS[item.failure.kind],
        tone: 'error',
        icon:
          item.failure.kind === 'cancelled'
            ? 'mdi:cancel'
            : 'mdi:alert-circle-outline',
        ...(item.failure.message && { detail: item.failure.message }),
      }
    }
    if (!item.result) {
      return {
        labelKey:
          item.operation === 'voiceCorrection'
            ? 'history.interrupted'
            : 'history.requestFailed',
        tone: 'error',
        icon: 'mdi:alert-circle-outline',
      }
    }
  }

  return undefined
}
