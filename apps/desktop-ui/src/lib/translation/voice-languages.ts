import { isRecord } from '@tyco/shared/value-guards'

import { messages } from '../i18n/messages'
import { COMMON_LANGUAGE_OPTIONS } from '../locale/language'
import { localeMessage } from '../operations/command-parameters'

/** The i18n key of the spoken names of the languages a text translates into */
export const VOICE_LANGUAGES_KEY = 'voiceGrammar.languages'

type LocaleId = keyof typeof messages

const baseLanguage = (tag: string) => tag.split('-')[0]!

const spokenIn = (localeId: string, value: string): string[] => {
  const locale = messages[localeId as LocaleId]
  const names = locale ? localeMessage(locale, VOICE_LANGUAGES_KEY) : undefined
  const spoken = isRecord(names) ? names[value] : undefined
  return typeof spoken === 'string'
    ? spoken
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

/**
 * Only the first listed variant of a language is spoken by its own name: the
 * names of the others start with the same word and need their region, which the
 * locales give, to tell them apart (`Español (España)` after `Español`)
 */
const isNamedByItself = (value: string) =>
  COMMON_LANGUAGE_OPTIONS.find(
    (option) => baseLanguage(option.id) === baseLanguage(value)
  )?.id === value

/**
 * A language is spoken in the words of the UI locale and also, whatever the
 * locale, in English and in itself: a Russian speaker may say "на English". In
 * itself means in every locale of the language: `pt-PT` has no locale, and
 * `pt-BR` names it, so "português europeu" is not taken for `pt-BR`.
 */
export function languageVoiceVariants(
  localeId: string,
  value: string
): string[] {
  const variants: string[] = []
  if (localeId !== 'en-US') variants.push(...spokenIn('en-US', value))
  for (const ownLocaleId of Object.keys(messages))
    if (
      ownLocaleId !== localeId &&
      baseLanguage(ownLocaleId) === baseLanguage(value)
    )
      variants.push(...spokenIn(ownLocaleId, value))
  const option = COMMON_LANGUAGE_OPTIONS.find((item) => item.id === value)
  if (option && isNamedByItself(value)) variants.push(option.name)
  return variants
}

/**
 * A phrase that names a language with and without its region means the language
 * itself: `es` over `es-ES` and `es-AR`. Variants with no common tag, such as
 * `pt-BR` and `pt-PT`, are left to the user.
 */
export function preferBaseLanguage(
  values: readonly string[]
): string | undefined {
  const base = values.find((value) => !value.includes('-'))
  return base && values.every((value) => baseLanguage(value) === base)
    ? base
    : undefined
}
