import type { EditorHistoryItem } from '@tyco/shared'

export interface EditorHistoryMeta {
  icon: string
  labelKey: string
}

const SOURCE_META: Record<
  NonNullable<EditorHistoryItem['operation']>,
  EditorHistoryMeta
> = {
  'ai-task': { icon: 'mdi:auto-fix', labelKey: 'history.kindBeforeAiTask' },
  translate: { icon: 'mdi:translate', labelKey: 'history.kindBeforeTranslate' },
  correction: {
    icon: 'mdi:spellcheck',
    labelKey: 'history.kindBeforeCorrection',
  },
  'voice-correction': {
    icon: 'mdi:microphone-outline',
    labelKey: 'history.kindVoiceTranscript',
  },
}

/** Icon and label that tell the user why the text is in the history. */
export function getEditorHistoryMeta(
  item: Pick<EditorHistoryItem, 'kind' | 'operation'>
): EditorHistoryMeta {
  if (item.kind === 'output') {
    return { icon: 'mdi:send-outline', labelKey: 'history.kindOutput' }
  }

  if (item.kind === 'source') {
    return (
      (item.operation && SOURCE_META[item.operation]) || {
        icon: 'mdi:history',
        labelKey: 'history.kindSource',
      }
    )
  }

  return { icon: 'mdi:pencil-outline', labelKey: 'history.kindDraft' }
}

/**
 * Short local date and time of an entry; empty when the time is unknown
 * (entries of the legacy format). `locale` is an app locale like `en_US`.
 */
export function formatEditorHistoryDate(
  createdAt: number,
  locale: string
): string {
  if (!createdAt) return ''

  const options: Intl.DateTimeFormatOptions = {
    dateStyle: 'short',
    timeStyle: 'short',
  }
  const date = new Date(createdAt)

  try {
    return new Intl.DateTimeFormat(locale.replace('_', '-'), options).format(
      date
    )
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date)
  }
}
