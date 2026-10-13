import {
  normalizeConfigField,
  DEFAULT_TRANSLATION_CONFIG,
  TRANSLATION_PROVIDERS,
  TRANSLATION_QUALITY_GATES,
  type TranslationConfig,
  type TranslationGlossaryEntry,
} from '@tyco/shared'

export function normalizeTranslationConfig(value: unknown): TranslationConfig {
  const input = normalizeConfigField('translation', value)
  const provider = TRANSLATION_PROVIDERS.includes(input.provider as never)
    ? (input.provider as TranslationConfig['provider'])
    : DEFAULT_TRANSLATION_CONFIG.provider
  const qualityGate = TRANSLATION_QUALITY_GATES.includes(
    input.qualityGate as never
  )
    ? (input.qualityGate as TranslationConfig['qualityGate'])
    : DEFAULT_TRANSLATION_CONFIG.qualityGate

  return {
    provider,
    qualityGate,
    deeplEndpoint: input.deeplEndpoint === 'pro' ? 'pro' : 'free',
    glossary: Array.isArray(input.glossary)
      ? input.glossary.flatMap(normalizeGlossaryEntry)
      : [],
    correctionPrompt:
      typeof input.correctionPrompt === 'string' ? input.correctionPrompt : '',
  }
}

function normalizeGlossaryEntry(value: unknown): TranslationGlossaryEntry[] {
  if (!isRecord(value)) return []
  const term = typeof value.term === 'string' ? value.term.trim() : ''
  if (!term) return []
  const use = typeof value.use === 'string' ? value.use.trim() : ''
  return [{ term, use, doNotTranslate: value.doNotTranslate === true }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
