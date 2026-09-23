import { AiError } from '@bozonx/ai-kit'

const PROTECTED_PATTERN =
  /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|https?:\/\/[^\s<>()]+|<\/?[A-Za-z][^<>]*>|\{\{[^{}]+\}\}|\$\{[^{}]+\}|\{[A-Za-z_][A-Za-z0-9_.-]*\}|%(?:\d+\$)?[A-Za-z]|%[A-Za-z0-9_]+%/g

export interface ProtectedText {
  text: string
  restore: (translated: string) => string
}

/** Keeps code, links and placeholders out of a machine translator. */
export function protectTranslationText(
  source: string,
  keptTerms: readonly string[] = []
): ProtectedText {
  const values: string[] = []
  const protect = (value: string) => {
    const index = values.push(value) - 1
    return `__TYCO_PROTECTED_${index}__`
  }
  let text = source.replace(PROTECTED_PATTERN, protect)

  for (const term of keptTerms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeForRegExp(term)}(?![\\p{L}\\p{N}_])`,
      'giu'
    )
    text = text.replace(pattern, protect)
  }

  return {
    text,
    restore(translated) {
      const missing = values
        .map((_, index) => `__TYCO_PROTECTED_${index}__`)
        .filter((token) => !translated.includes(token))
      if (missing.length > 0) {
        throw new AiError(
          'invalid_output',
          `Translation changed ${missing.length} protected token(s)`
        )
      }
      return values.reduce(
        (result, value, index) =>
          result.replaceAll(`__TYCO_PROTECTED_${index}__`, value),
        translated
      )
    },
  }
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
