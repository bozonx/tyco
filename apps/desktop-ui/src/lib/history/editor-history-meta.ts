import type { EditorHistoryItem, EditorHistoryOperation } from '@tyco/shared'

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
  sent: boolean
}

const OPERATION_ICONS: Record<EditorHistoryOperation, string> = {
  'ai-task': 'mdi:auto-fix',
  translate: 'mdi:translate',
  correction: 'mdi:spellcheck',
  'voice-correction': 'mdi:microphone-outline',
}

/** Label of an entry that holds the AI result. */
const RESULT_LABELS: Record<EditorHistoryOperation, string> = {
  'ai-task': 'history.kindAiTask',
  translate: 'history.kindTranslate',
  correction: 'history.kindCorrection',
  'voice-correction': 'history.kindVoiceInput',
}

/** Label of a source the AI produced nothing from (failed or cancelled). */
const SOURCE_LABELS: Record<EditorHistoryOperation, string> = {
  'ai-task': 'history.kindBeforeAiTask',
  translate: 'history.kindBeforeTranslate',
  correction: 'history.kindBeforeCorrection',
  'voice-correction': 'history.kindVoiceTranscript',
}

/** Icon and label that tell the user why the text is in the history. */
export function getEditorHistoryMeta(
  item: Pick<EditorHistoryItem, 'kind' | 'operation' | 'result'>
): EditorHistoryMeta {
  if (item.kind === 'output') {
    return { icon: 'mdi:export-variant', labelKey: 'history.kindOutput' }
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
    Partial<Pick<EditorHistoryItem, 'sent'>>
): EditorHistoryView {
  const meta = getEditorHistoryMeta(item)

  if (item.kind !== 'source' || !item.result) {
    return { ...meta, text: item.text, sent: false }
  }

  return {
    ...meta,
    text: item.result,
    original: {
      labelKey:
        item.operation === 'voice-correction'
          ? 'history.originalTranscript'
          : 'history.original',
      text: item.text,
    },
    sent: !!item.sent,
  }
}
