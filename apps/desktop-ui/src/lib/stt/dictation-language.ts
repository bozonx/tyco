/**
 * What Deepgram's nova-3 multilingual model follows. Anything spoken in these
 * is recognized without naming the language, switching mid-sentence included,
 * which is what dictating something to be translated needs.
 */
const MULTILINGUAL_LANGUAGES = new Set([
  'en',
  'es',
  'fr',
  'de',
  'hi',
  'ru',
  'pt',
  'ja',
  'it',
  'nl',
])

/**
 * The language to ask a live session for, given the user's locale (`ru_RU`).
 * `undefined` means the multilingual model; a language it does not cover has to
 * be named, or it would not be recognized at all.
 */
export function liveLanguageFor(userLocale?: string): string | undefined {
  const language = userLocale?.split(/[_-]/)[0]?.trim().toLowerCase()
  if (!language || MULTILINGUAL_LANGUAGES.has(language)) return undefined
  return language
}
