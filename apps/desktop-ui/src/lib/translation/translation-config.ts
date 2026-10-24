import {
  normalizeConfigField,
  normalizeGlossaryEntry,
  type TranslationConfig,
} from '@tyco/shared'

/** The schema repairs the fields; glossary rows are normalized as on load. */
export function normalizeTranslationConfig(value: unknown): TranslationConfig {
  const config = normalizeConfigField('translation', value)
  return {
    ...config,
    glossary: config.glossary.flatMap(
      (entry) => normalizeGlossaryEntry(entry) ?? []
    ),
  }
}
