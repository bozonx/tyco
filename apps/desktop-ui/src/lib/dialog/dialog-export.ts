import {
  buildDialogTurns,
  turnText,
  turnTranslation,
  type DialogSegment,
  type DialogSessionBreak,
  type DialogSide,
} from './dialog-transcript'

export interface DialogExportOptions {
  includeTranslation: boolean
  /** The localized names of the sides and of the translation line */
  labels: Record<DialogSide, string> & {
    translation: string
    sessionResumed?: string
    sessionResumedRecording?: string
    sessionStartedListening?: string
    sessionStartedRecording?: string
    sessionResumedListening?: string
  }
  /** Breaks between resumed sessions */
  breaks?: readonly DialogSessionBreak[]
  /** How the start of a turn is written; the clock time by default */
  formatTime?: (startMs: number) => string
}

/** The local time of day a turn began, `hh:mm:ss` */
export function formatDialogClock(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * The transcript as text, a block per turn: when, who and what was said, then
 * optionally its translation, indented under it. The guesses the providers
 * still revise are left out.
 */
export function exportDialogTranscript(
  segments: readonly DialogSegment[],
  options: DialogExportOptions
): string {
  const formatTime = options.formatTime ?? formatDialogClock
  const turns = buildDialogTurns(segments.filter((segment) => segment.isFinal))
  type ExportItem =
    | { type: 'turn'; timestampMs: number; lines: string[] }
    | { type: 'break'; timestampMs: number; text: string }

  const items: ExportItem[] = []
  for (const turn of turns) {
    const text = turnText(turn)
    if (!text) continue
    const prefix = `[${formatTime(turn.startMs)}] `
    const lines = [`${prefix}${options.labels[turn.side]}: ${text}`]
    const translation = turnTranslation(turn)
    if (options.includeTranslation && translation)
      lines.push(
        `${' '.repeat(prefix.length)}${options.labels.translation}: ${translation}`
      )
    items.push({ type: 'turn', timestampMs: turn.startMs, lines })
  }

  if (options.breaks) {
    for (const b of options.breaks) {
      const label =
        b.action === 'started'
          ? b.isRecording
            ? (options.labels.sessionStartedRecording ?? 'Recording started')
            : (options.labels.sessionStartedListening ?? 'Listening started')
          : b.isRecording
            ? (options.labels.sessionResumedRecording ?? 'Recording resumed')
            : (options.labels.sessionResumedListening ??
              options.labels.sessionResumed ??
              'Listening resumed')
      items.push({
        type: 'break',
        timestampMs: b.timestampMs,
        text: `--- ${label} · ${formatTime(b.timestampMs)} ---`,
      })
    }
  }

  items.sort((a, b) => a.timestampMs - b.timestampMs)
  return items
    .map((item) => (item.type === 'turn' ? item.lines.join('\n') : item.text))
    .join('\n')
}
