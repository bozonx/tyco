/**
 * Split separators, camel-case boundaries and acronyms without splitting
 * Unicode letters.
 */
function splitWords(text?: string): string[] {
  if (!text) return []
  return text
    .replace(/(\p{Lu}\p{M}*)(\p{Lu}\p{M}*\p{Ll})/gu, '$1 $2')
    .replace(/([\p{Ll}\p{N}]\p{M}*)(\p{Lu})/gu, '$1 $2')
    .split(/[\s_-]+/u)
    .filter(Boolean)
}

function capitalize(word: string): string {
  const lower = word.toLowerCase()
  const first = Array.from(lower)[0]
  return first ? first.toUpperCase() + lower.slice(first.length) : ''
}

export function toCamelCase(text?: string): string {
  return splitWords(text)
    .map((word, index) => (index === 0 ? word.toLowerCase() : capitalize(word)))
    .join('')
}

export function toPascalCase(text?: string): string {
  return splitWords(text).map(capitalize).join('')
}

export function toSnakeCase(text?: string): string {
  return splitWords(text)
    .map((word) => word.toLowerCase())
    .join('_')
}

export function toKebabCase(text?: string): string {
  return splitWords(text)
    .map((word) => word.toLowerCase())
    .join('-')
}

export function toConstantCase(text?: string): string {
  return splitWords(text)
    .map((word) => word.toUpperCase())
    .join('_')
}

export function identifierToText(text?: string): string {
  return splitWords(text)
    .map((word, index) => (index === 0 ? capitalize(word) : word.toLowerCase()))
    .join(' ')
}

/** Capitalize the first letter without changing the rest of the selection. */
export function capitalizeFirst(text: string): string {
  return text.replace(/\p{L}/u, (letter) => letter.toUpperCase())
}

/** Best-effort sentence casing; preserves whitespace and identifier separators. */
export function sentenceCase(text: string): string {
  return capitalizeFirst(text.toLowerCase()).replace(
    /([.!?]["'\u00bb\u201d)\]]*\s+|[\r\n]+\s*)(\p{L})/gu,
    (_match, boundary: string, letter: string) =>
      boundary + letter.toUpperCase()
  )
}
