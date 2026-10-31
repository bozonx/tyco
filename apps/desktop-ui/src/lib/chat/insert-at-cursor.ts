import { needsSpaceBetween } from '../text/word-spacing'

export interface TextRange {
  start: number
  end: number
}

export interface InsertResult {
  value: string
  /** Caret position right after the inserted text */
  caret: number
}

/**
 * Inserts a text in place of the range, or at the end without one. Spaces are
 * added where the text would otherwise stick to a neighbouring word, see
 * `needsSpaceBetween`.
 */
export function insertAtCursor(
  value: string,
  range: TextRange | null,
  text: string
): InsertResult {
  const start = clamp(range?.start ?? value.length, value.length)
  const end = clamp(Math.max(range?.end ?? start, start), value.length)
  const before = value.slice(0, start)
  const after = value.slice(end)
  const leading = needsSpaceBetween(before, text) ? ' ' : ''
  const trailing = needsSpaceBetween(text, after) ? ' ' : ''
  const inserted = `${leading}${text}${trailing}`

  return {
    value: `${before}${inserted}${after}`,
    caret: before.length + leading.length + text.length,
  }
}

function clamp(position: number, length: number): number {
  return Math.min(Math.max(position, 0), length)
}
