const PROTECTED_PATTERN =
  /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|https?:\/\/[^\s<>()]+|\{\{[^{}]+\}\}|\$\{[^{}]+\}|%[A-Za-z0-9_]+%/g

export interface ProtectedText {
  text: string
  restore: (translated: string) => string
}

/** Keeps code, links and placeholders out of a machine translator. */
export function protectTranslationText(source: string): ProtectedText {
  const values: string[] = []
  const text = source.replace(PROTECTED_PATTERN, (value) => {
    const index = values.push(value) - 1
    return `TYCOPROTECTED${index}TOKEN`
  })

  return {
    text,
    restore(translated) {
      return values.reduce(
        (result, value, index) =>
          result.replaceAll(`TYCOPROTECTED${index}TOKEN`, value),
        translated
      )
    },
  }
}
