import {
  buildDialogTurns,
  turnText,
  turnTranslation,
  type DialogSegment,
  type DialogSide,
} from './dialog-transcript'

export interface DialogExportOptions {
  includeTranslation: boolean
  /** The localized names of the sides and of the translation line */
  labels: Record<DialogSide, string> & { translation: string }
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
  return buildDialogTurns(segments.filter((segment) => segment.isFinal))
    .flatMap((turn) => {
      const text = turnText(turn)
      if (!text) return []
      const prefix = `[${formatTime(turn.startMs)}] `
      const lines = [`${prefix}${options.labels[turn.side]}: ${text}`]
      const translation = turnTranslation(turn)
      if (options.includeTranslation && translation)
        lines.push(
          `${' '.repeat(prefix.length)}${options.labels.translation}: ${translation}`
        )
      return [lines.join('\n')]
    })
    .join('\n')
}
