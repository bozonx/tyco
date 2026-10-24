import type { TranslationConfig } from '@tyco/shared'

import { messages } from '../i18n/messages'
import { COMMON_LANGUAGE_OPTIONS, normalizeLocale } from '../locale/language'
import deepl from './languages/deepl.json'
import google from './languages/google.json'
import qwen35 from './languages/qwen35.json'

export type TranslationProvider = TranslationConfig['provider']
export type TranslationDirection = 'source' | 'target'

/** Qwen3.5's published catalog plus existing regional and script preferences. */
const llm: Record<string, string> = {
  ...qwen35,
  ...Object.fromEntries(
    COMMON_LANGUAGE_OPTIONS.filter(({ id }) => id.includes('-')).map(
      ({ id, name }) => [id, name]
    )
  ),
  ...Object.fromEntries(
    Object.entries({ ...deepl.target, ...google.target }).filter(
      ([id]) =>
        id.includes('-') &&
        (Object.hasOwn(qwen35, id.split('-')[0]) || id.startsWith('zh-'))
    )
  ),
}
const catalogs: Record<
  TranslationProvider,
  Record<TranslationDirection, Record<string, string>>
> = { llm: { source: llm, target: llm }, deepl, google }
const names: Record<string, string | undefined> = {
  ...deepl.source,
  ...deepl.target,
  ...google.target,
  ...llm,
}
const nativeNames = new Map(
  COMMON_LANGUAGE_OPTIONS.map(({ id, name }) => [id as string, name])
)
const messageNames: Record<string, string | undefined> =
  messages['en-US'].language
const displayNames = new Map<string, Intl.DisplayNames>()
const labels = new Map<string, Map<string, string>>()

/** Model and provider language names are data, not missing application messages. */
export function translationLanguageLabel(id: string, locale: string): string {
  let localized = labels.get(locale)
  if (!localized) {
    localized = new Map()
    labels.set(locale, localized)
  }
  const cached = localized.get(id)
  if (cached) return cached
  let formatter = displayNames.get(locale)
  if (!formatter) {
    formatter = new Intl.DisplayNames([locale], {
      type: 'language',
      fallback: 'none',
    })
    displayNames.set(locale, formatter)
  }
  let name = names[id] ?? id
  try {
    // CLDR merges some dialect codes into a broader language (dhd -> mwr).
    // Keep the published name so separate entries remain distinguishable.
    if (!Object.hasOwn(qwen35, id) || Intl.getCanonicalLocales(id)[0] === id)
      name = formatter.of(id) ?? name
  } catch {
    /* Preserve published names for tags unknown to the runtime. */
  }
  localized.set(id, name)
  return name
}

export function translationLanguageNativeName(id: string): string | undefined {
  return nativeNames.get(id)
}

export function translationLanguageSearchNames(id: string): string[] {
  return [
    ...new Set(
      [
        nativeNames.get(id),
        messageNames[id],
        names[id],
        translationLanguageLabel(id, 'en'),
      ].filter((name): name is string => Boolean(name))
    ),
  ]
}

export function translationLanguageIds(
  provider: TranslationProvider,
  direction: TranslationDirection
): string[] {
  return Object.keys(catalogs[provider][direction])
}

/** Resolve stored locale variants to the codes accepted by a machine provider. */
export function resolveTranslationLanguage(
  id: string,
  provider: TranslationProvider,
  direction: TranslationDirection
): string | undefined {
  const catalog = catalogs[provider][direction]
  if (Object.hasOwn(catalog, id.trim())) return id.trim()
  const normalized = normalizeLocale(id)
  if (Object.hasOwn(catalog, normalized)) return normalized
  if (provider === 'llm') return undefined
  const [base, region] = normalized.split('-')
  if (base === 'zh') {
    const traditional = region === 'TW' || region === 'HK' || region === 'Hant'
    const chinese =
      provider === 'deepl'
        ? direction === 'source'
          ? 'zh'
          : traditional
            ? 'zh-Hant'
            : 'zh-Hans'
        : traditional
          ? 'zh-TW'
          : 'zh-CN'
    if (Object.hasOwn(catalog, chinese)) return chinese
  }
  if (
    provider === 'deepl' &&
    direction === 'target' &&
    base === 'es' &&
    region &&
    region !== 'ES'
  )
    return 'es-419'
  return base && Object.hasOwn(catalog, base) ? base : undefined
}

export function translationLanguageOptions(
  provider: TranslationProvider,
  locale: string,
  direction: TranslationDirection = 'target'
) {
  const collator = new Intl.Collator(locale)
  return translationLanguageIds(provider, direction)
    .map((id) => ({ id, name: translationLanguageLabel(id, locale) }))
    .sort((a, b) => collator.compare(a.name, b.name))
}
