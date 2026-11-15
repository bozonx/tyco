/** Where a language comes from in the picker list */
export type LanguageGroup = 'recent' | 'frequent' | 'all'

export interface GroupedLanguage {
  id: string
  group: LanguageGroup
}

export {
  translationLanguageNativeName as nativeLanguageName,
  translationLanguageSearchNames as languageSearchNames,
} from './translation-languages'

/**
 * The picker list: the recent picks, the frequent picks, then all the other
 * languages in the order of their labels. `exclude` (the language of the other
 * field) is left out.
 */
export function groupLanguages(
  recent: readonly string[],
  all: readonly string[],
  label: (id: string) => string,
  exclude?: string,
  locale?: string,
  frequent: readonly string[] = []
): GroupedLanguage[] {
  const known = new Set(all)
  const recentIds = [...new Set(recent)]
    .filter((id) => id !== exclude && known.has(id))
    .slice(0, 5)
  const frequentIds = [...new Set(frequent)]
    .filter((id) => id !== exclude && known.has(id) && !recentIds.includes(id))
    .slice(0, 5)
  const taken = new Set([...recentIds, ...frequentIds, exclude])
  const collator = new Intl.Collator(locale, { sensitivity: 'base' })
  const others = all
    .filter((id) => !taken.has(id))
    .sort((a, b) => collator.compare(label(a), label(b)))

  return [
    ...recentIds.map((id) => ({ id, group: 'recent' as const })),
    ...frequentIds.map((id) => ({ id, group: 'frequent' as const })),
    ...others.map((id) => ({ id, group: 'all' as const })),
  ]
}
