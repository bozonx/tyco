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

/**
 * Capitalizes every word and lowercases the rest: `HELLO world` → `Hello
 * World`.
 */
export function titleCase(text: string): string {
  return text.replace(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’]*/gu, (word) => {
    const first = Array.from(word)[0]!
    return first.toUpperCase() + word.slice(first.length).toLowerCase()
  })
}

/** Swaps the case of every letter: `Hello World` → `hELLO wORLD`. */
export function invertCase(text: string): string {
  return Array.from(text, (char) => {
    const upper = char.toUpperCase()
    const lower = char.toLowerCase()
    if (char === upper && char !== lower) return lower
    if (char === lower && char !== upper) return upper
    return char
  }).join('')
}

/**
 * Applies an identifier transform to every line on its own, so a multi-line
 * selection stays multi-line; indentation and blank lines are kept.
 */
export function perLine(
  transform: (text: string) => string
): (text: string) => string {
  return (text) =>
    text
      .split(/(\r?\n)/)
      .map((part, index) => {
        if (index % 2 === 1) return part
        const [, leading = '', body = '', trailing = ''] =
          /^(\s*)([\s\S]*?)(\s*)$/.exec(part) ?? []
        if (!body) return part
        const result = transform(body)
        return result ? leading + result + trailing : part
      })
      .join('')
}
