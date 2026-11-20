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
}

/** `mm:ss`, or `h:mm:ss` past an hour */
export function formatDialogTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}

/**
 * The transcript as text, a block per turn: when, who and what was said, then
 * optionally its translation, indented under it.
 */
export function exportDialogTranscript(
  segments: readonly DialogSegment[],
  options: DialogExportOptions
): string {
  return buildDialogTurns(segments)
    .flatMap((turn) => {
      const text = turnText(turn)
      if (!text) return []
      const prefix = `[${formatDialogTime(turn.startMs)}] `
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
