/** The provider determines the spoken language from the audio. */
export const DICTATION_LANGUAGE_AUTO = 'auto'

/** `multi` is accepted only for compatibility with saved settings. */
export function dictationLanguageFor(setting?: string): string | undefined {
  if (!setting || setting === DICTATION_LANGUAGE_AUTO || setting === 'multi')
    return undefined
  const [language, region] = setting.trim().split('-')
  if (!language) return undefined
  if (language.toLowerCase() === 'zh' && region)
    return `zh-${region.toUpperCase()}`
  return language.toLowerCase()
}
