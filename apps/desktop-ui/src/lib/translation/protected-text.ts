import { AiError } from '@bozonx/ai-kit'

const PROTECTED_PATTERN =
  /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|https?:\/\/[^\s<>()]+|<\/?(?:[a-zA-Z][a-zA-Z0-9:-]*)(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*=(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))*\s*\/?>|\{\{[^{}]+\}\}|\$\{[^{}]+\}|\{[A-Za-z_][A-Za-z0-9_.-]*\}|(?<![\p{L}\p{N}])%(?:\d+\$)?[A-Za-z](?![A-Za-z])|%[A-Za-z0-9_]+%/gu

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
  let prefix = '__TYCO_PROTECTED_'
  while (source.includes(prefix)) prefix = `_${prefix}`
  const protect = (value: string) => {
    const index = values.push(value) - 1
    return `${prefix}${index}__`
  }
  let text = source.replace(PROTECTED_PATTERN, protect)

  for (const term of keptTerms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeForRegExp(term)}(?![\\p{L}\\p{N}_])`,
      'gu'
    )
    text = text.replace(pattern, protect)
  }

  return {
    text,
    restore(translated) {
      // Tolerate whitespace variations and casing shifts introduced by MT providers
      const leading = prefix.match(/^_+/)?.[0] ?? '__'
      const tokenPattern = new RegExp(
        `${escapeForRegExp(leading)}\\s*TYCO[\\s_]*PROTECTED[\\s_]*(\\d+)\\s*(?:__|_[\\s]*_)`,
        'gi'
      )
      const normalized = translated.replace(tokenPattern, `${prefix}$1__`)
      const missing = values
        .map((_, index) => `${prefix}${index}__`)
        .filter((token) => normalized.split(token).length !== 2)
      if (missing.length > 0) {
        throw new AiError(
          'invalid_output',
          `Translation changed ${missing.length} protected token(s)`
        )
      }
      return normalized.replace(
        new RegExp(`${escapeForRegExp(prefix)}(\\d+)__`, 'g'),
        (token, index: string) => values[Number(index)] ?? token
      )
    },
  }
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
