/** How much of a tool's output the model is given by default */
export const TOOL_OUTPUT_CHARACTERS = 20_000

export interface ToolOutput {
  /** What the model and the chat get: the output, cut to the limit */
  text: string
  isTruncated: boolean
  /** The size of the whole output, before it was cut */
  totalCharacters: number
}

/** A tool's output as the text the chat keeps, uncut */
export function toolOutputText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * A tool's output as text, cut to `limitCharacters`. A cut output ends with a
 * note that tells the model how much it saw and how to ask for the rest, so it
 * does not answer from half a file as if it were all of it
 */
export function normalizeToolOutput(
  value: unknown,
  limitCharacters = TOOL_OUTPUT_CHARACTERS
): ToolOutput {
  const full = toolOutputText(value)
  const limit = Math.max(0, Math.floor(limitCharacters))
  if (full.length <= limit) {
    return { text: full, isTruncated: false, totalCharacters: full.length }
  }
  const noteFor = (shown: number) =>
    `\n\n[Output truncated: showing the first ${shown} ` +
    `of ${full.length} characters. If the tool takes offset and limit, ` +
    `call it again with offset ${shown} for the rest.]`
  // Reserve the longest possible note before cutting; digit counts may shrink.
  const shown = Math.max(0, limit - noteFor(limit).length)
  const note = noteFor(shown)
  const text =
    note.length <= limit
      ? full.slice(0, shown) + note
      : '[Output truncated]'.slice(0, limit)
  return { text, isTruncated: true, totalCharacters: full.length }
}
