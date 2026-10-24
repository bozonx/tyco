/** Where a language comes from in the picker list */
export type LanguageGroup = 'recent' | 'all'

export interface GroupedLanguage {
  id: string
  group: LanguageGroup
}

export {
  translationLanguageNativeName as nativeLanguageName,
  translationLanguageSearchNames as languageSearchNames,
} from './translation-languages'

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
