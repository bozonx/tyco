/** Follow the user's own language, from the general settings */
export const DICTATION_LANGUAGE_USER = 'auto'
/**
 * Deepgram's multilingual model: follows several languages, switching
 * mid-sentence included, but mistakes one language for another far more often
 * than a model told what to expect.
 */
export const DICTATION_LANGUAGE_MULTI = 'multi'

/**
 * The language tag to ask a live session for. `setting` is the dictation
 * language from the speech settings, `userLocale` the resolved user language
 * (`ru_RU`). `undefined` means the multilingual model.
 */
export function dictationLanguageFor(
  setting: string | undefined,
  userLocale: string | undefined
): string | undefined {
  if (setting === DICTATION_LANGUAGE_MULTI) return undefined
  const locale =
    !setting || setting === DICTATION_LANGUAGE_USER ? userLocale : setting
  return toProviderTag(locale)
}

/** `ru_RU` → `ru`; Chinese keeps its script region, the only one that matters */
function toProviderTag(locale: string | undefined): string | undefined {
  const [language, region] = (locale ?? '')
    .trim()
    .split(/[_-]/)
    .map((part) => part.toLowerCase())
  if (!language) return undefined
  if (language === 'zh' && region) return `zh-${region.toUpperCase()}`
  return language
}
