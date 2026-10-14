import { normalizeConfigField, type TranslationConfig } from '@tyco/shared'

/** The schema repairs the fields; glossary rows are trimmed as on load. */
export function normalizeTranslationConfig(value: unknown): TranslationConfig {
  const config = normalizeConfigField('translation', value)
  return {
    ...config,
    glossary: config.glossary.flatMap((entry) => {
      const term = entry.term.trim()
      return term ? [{ ...entry, term, use: entry.use.trim() }] : []
    }),
  }
}
