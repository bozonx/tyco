/** Restores whitespace that text generation can drop at selection boundaries. */
export function keepSurroundingWhitespace(
  original: string,
  result: string
): string {
  const leading = /^\s*/.exec(original)?.[0] ?? ''
  const trailing = /\s*$/.exec(original)?.[0] ?? ''
  return `${leading}${result.trim()}${trailing}`
}
