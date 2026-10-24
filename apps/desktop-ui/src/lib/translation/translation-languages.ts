import type { TranslationConfig } from '@tyco/shared'

import { messages } from '../i18n/messages'
import { COMMON_LANGUAGE_OPTIONS, normalizeLocale } from '../locale/language'
import deepl from './languages/deepl.json'
import google from './languages/google.json'
import iana from './languages/iana.json'

export type TranslationProvider = TranslationConfig['provider']
export type TranslationDirection = 'source' | 'target'

const llm: Record<string, string> = {
  ...iana,
  ...Object.fromEntries(
    COMMON_LANGUAGE_OPTIONS.map(({ id, name }) => [id, name])
  ),
  ...deepl.target,
  ...google.target,
}
const catalogs: Record<
  TranslationProvider,
  Record<TranslationDirection, Record<string, string>>
> = { llm: { source: llm, target: llm }, deepl, google }
const names: Record<string, string | undefined> = { ...llm, ...iana }
const nativeNames = new Map(
  COMMON_LANGUAGE_OPTIONS.map(({ id, name }) => [id as string, name])
)
const messageNames: Record<string, string | undefined> =
  messages['en-US'].language
const displayNames = new Map<string, Intl.DisplayNames>()
const labels = new Map<string, Map<string, string>>()

/** Registry and provider names are data, not missing application messages. */
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
    name = formatter.of(id) ?? name
  } catch {
    /* Preserve registry names for tags unknown to the runtime. */
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
