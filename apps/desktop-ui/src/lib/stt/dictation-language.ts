/** The provider determines the spoken language from the audio. */
export const DICTATION_LANGUAGE_AUTO = 'auto'

/**
 * Regional variants Deepgram tells apart. Any other region is sent as its base
 * language, which Deepgram does know.
 */
const DEEPGRAM_REGIONAL_LANGUAGES: ReadonlySet<string> = new Set([
  'en-US',
  'en-GB',
  'en-AU',
  'en-IN',
  'en-NZ',
  'es-419',
  'fr-CA',
  'de-CH',
  'pt-BR',
  'pt-PT',
  'nl-BE',
  'ko-KR',
  'zh-CN',
  'zh-TW',
  'zh-HK',
  'sv-SE',
  'da-DK',
  'th-TH',
])

/** `multi` is accepted only for compatibility with saved settings. */
export function dictationLanguageFor(setting?: string): string | undefined {
  if (!setting || setting === DICTATION_LANGUAGE_AUTO || setting === 'multi')
    return undefined
  const [rawLanguage, rawRegion] = setting.trim().split('-')
  const language = rawLanguage?.toLowerCase()
  if (!language) return undefined
  if (rawRegion) {
    const regional = `${language}-${rawRegion.toUpperCase()}`
    if (DEEPGRAM_REGIONAL_LANGUAGES.has(regional)) return regional
  }
  return language
}
