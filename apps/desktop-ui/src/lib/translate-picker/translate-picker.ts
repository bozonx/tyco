import { messages } from '../i18n/messages'
import { SUPPORTED_USER_LANGUAGE_OPTIONS } from '../locale/language'

/** Where a language comes from in the picker list */
export type LanguageGroup = 'recent' | 'all'

export interface GroupedLanguage {
  id: string
  group: LanguageGroup
}

const NATIVE_NAMES = new Map<string, string>(
  SUPPORTED_USER_LANGUAGE_OPTIONS.map((option) => [option.id, option.name])
)

const ENGLISH_NAMES: Record<string, string | undefined> =
  messages.en_US.language

/** The name of a language in itself, e.g. `Polski` */
export function nativeLanguageName(id: string): string | undefined {
  return NATIVE_NAMES.get(id)
}

/**
 * Names a language is found by besides its label in the interface language: its
 * native and English names, so it is found whatever the interface language
 */
export function languageSearchNames(id: string): string[] {
  return [
    ...new Set(
      [NATIVE_NAMES.get(id), ENGLISH_NAMES[id]].filter((name): name is string =>
        Boolean(name)
      )
    ),
  ]
}

/**
 * The picker list: the recent picks, then all the other languages in the order
 * of their labels. `exclude` (the language of the other field) is left out.
 */
export function groupLanguages(
  recent: readonly string[],
  all: readonly string[],
  label: (id: string) => string,
  exclude?: string
): GroupedLanguage[] {
  const known = new Set(all)
  const recentIds = [...new Set(recent)].filter(
    (id) => id !== exclude && known.has(id)
  )
  const taken = new Set([...recentIds, exclude])
  const others = all
    .filter((id) => !taken.has(id))
    .sort((a, b) => label(a).localeCompare(label(b)))

  return [
    ...recentIds.map((id) => ({ id, group: 'recent' as const })),
    ...others.map((id) => ({ id, group: 'all' as const })),
  ]
}
