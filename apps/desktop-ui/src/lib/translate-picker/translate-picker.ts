import { AUTO_LANGUAGE_VALUE } from '../locale/language'

/** Where a language comes from in the picker list */
export type LanguageGroup = 'recent' | 'mine' | 'all'

export interface GroupedLanguage {
  id: string
  group: LanguageGroup
}

export interface LanguageSources {
  /** Languages picked from the full list, the newest first */
  recent: readonly string[]
  /** Languages set up in the settings, empty slots included */
  configured: readonly (string | null)[]
  /** Every supported language */
  all: readonly string[]
}

const present = (lang: string | null): lang is string => Boolean(lang)

/**
 * The picker list: recent picks, then the configured languages, then all the
 * others. Each language shows up once, in the first group that has it;
 * `exclude` (the language of the other field) is left out.
 */
export function groupLanguages(
  sources: LanguageSources,
  exclude?: string
): GroupedLanguage[] {
  const seen = new Set<string>(exclude ? [exclude] : [])
  const result: GroupedLanguage[] = []
  const add = (ids: readonly string[], group: LanguageGroup) => {
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      result.push({ id, group })
    }
  }

  add(sources.recent, 'recent')
  add(sources.configured.filter(present), 'mine')
  add(sources.all, 'all')

  return result
}

/** The target the picker opens with: the last pick, else the first configured */
export function defaultTargetLanguage(
  sources: Pick<LanguageSources, 'recent' | 'configured'>,
  source: string
): string | undefined {
  return [...sources.recent, ...sources.configured.filter(present)].find(
    (id) => id !== source
  )
}

/** The languages can be swapped when both are set and auto-detect is not one */
export function canSwapLanguages(
  source: string,
  target: string | undefined
): target is string {
  return Boolean(target) && source !== AUTO_LANGUAGE_VALUE && source !== target
}
