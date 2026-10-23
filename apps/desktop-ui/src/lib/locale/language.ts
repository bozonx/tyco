export const AUTO_LANGUAGE_VALUE = 'auto'
export const DEFAULT_LANGUAGE = 'ru-RU'
const DEFAULT_UI_LANGUAGE = 'en-US'

export const SUPPORTED_USER_LANGUAGE_OPTIONS = [
  { id: 'ru-RU', name: 'Русский' },
  { id: 'en-US', name: 'English (US)' },
  { id: 'en-GB', name: 'English (UK)' },
  { id: 'es-ES', name: 'Español (España)' },
  { id: 'es-AR', name: 'Español (Argentina)' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'pt-PT', name: 'Português (Portugal)' },
  { id: 'de-DE', name: 'Deutsch' },
  { id: 'fr-FR', name: 'Français' },
  { id: 'it-IT', name: 'Italiano' },
  { id: 'nl-NL', name: 'Nederlands' },
  { id: 'pl-PL', name: 'Polski' },
  { id: 'uk-UA', name: 'Українська' },
  { id: 'tr-TR', name: 'Türkçe (Türkiye)' },
  { id: 'ar-SA', name: 'العربية' },
  { id: 'hi-IN', name: 'हिन्दी' },
  { id: 'bn-BD', name: 'বাংলা' },
  { id: 'ur-PK', name: 'اردو' },
  { id: 'fa-IR', name: 'فارسی' },
  { id: 'he-IL', name: 'עברית' },
  { id: 'zh-CN', name: '中文 (简体)' },
  { id: 'zh-TW', name: '中文 (繁體)' },
  { id: 'ja-JP', name: '日本語' },
  { id: 'ko-KR', name: '한국어' },
  { id: 'vi-VN', name: 'Tiếng Việt' },
  { id: 'th-TH', name: 'ไทย' },
  { id: 'id-ID', name: 'Bahasa Indonesia' },
  { id: 'ms-MY', name: 'Bahasa Melayu' },
] as const

export const SUPPORTED_UI_LANGUAGE_OPTIONS = [
  { id: 'ru-RU', name: 'Русский' },
  { id: 'en-US', name: 'English (US)' },
  { id: 'es-AR', name: 'Español (Argentina)' },
  { id: 'tr-TR', name: 'Türkçe (Türkiye)' },
] as const

const SUPPORTED_USER_LANGUAGE_CODES: readonly string[] =
  SUPPORTED_USER_LANGUAGE_OPTIONS.map((option) => option.id)

const SUPPORTED_UI_LANGUAGE_CODES: readonly string[] =
  SUPPORTED_UI_LANGUAGE_OPTIONS.map((option) => option.id)

function splitLocale(locale: string) {
  return locale.trim().split(/[-_]/).filter(Boolean)
}

export function normalizeLocale(locale?: string | null): string {
  if (!locale) {
    return DEFAULT_LANGUAGE
  }

  const [language = '', region = ''] = splitLocale(locale)

  if (!language) {
    return DEFAULT_LANGUAGE
  }

  if (!region) {
    return language.toLowerCase()
  }

  return `${language.toLowerCase()}-${region.toUpperCase()}`
}

function findSupportedLocale(
  locale: string,
  supportedLocales: readonly string[]
): string | null {
  const normalized = normalizeLocale(locale)

  if (supportedLocales.includes(normalized)) {
    return normalized
  }

  const [language] = normalized.split('-')

  return (
    supportedLocales.find((supportedLocale) =>
      supportedLocale.startsWith(`${language}-`)
    ) || null
  )
}

export function getNavigatorLanguages(): string[] {
  if (typeof navigator === 'undefined') {
    return []
  }

  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages
  }

  return navigator.language ? [navigator.language] : []
}

export function resolveAutoLanguage(
  navigatorLanguages: readonly string[],
  fallbackLanguage = DEFAULT_LANGUAGE
): string {
  for (const navigatorLanguage of navigatorLanguages) {
    const matchedLanguage = findSupportedLocale(
      navigatorLanguage,
      SUPPORTED_USER_LANGUAGE_CODES
    )

    if (matchedLanguage) {
      return matchedLanguage
    }
  }

  return fallbackLanguage
}

export function resolveLanguagePreference(
  configuredLanguage?: string | null,
  navigatorLanguages: readonly string[] = getNavigatorLanguages(),
  fallbackLanguage = DEFAULT_LANGUAGE
): string {
  if (!configuredLanguage || configuredLanguage === AUTO_LANGUAGE_VALUE) {
    return resolveAutoLanguage(navigatorLanguages, fallbackLanguage)
  }

  return (
    findSupportedLocale(configuredLanguage, SUPPORTED_USER_LANGUAGE_CODES) ||
    normalizeLocale(configuredLanguage)
  )
}

export function resolveUiLanguageFromUserLanguage(
  userLanguage: string,
  fallbackLanguage = DEFAULT_UI_LANGUAGE
): string {
  const normalizedUserLanguage = normalizeLocale(userLanguage)

  if (SUPPORTED_UI_LANGUAGE_CODES.includes(normalizedUserLanguage)) {
    return normalizedUserLanguage
  }

  const [language] = normalizedUserLanguage.split('-')
  const partialMatch = SUPPORTED_UI_LANGUAGE_CODES.find((supportedLocale) =>
    supportedLocale.startsWith(`${language}-`)
  )

  return partialMatch || fallbackLanguage
}

export function resolveUiLanguagePreference(
  configuredAppLanguage?: string | null,
  configuredUserLanguage?: string | null,
  navigatorLanguages: readonly string[] = getNavigatorLanguages(),
  fallbackLanguage = DEFAULT_UI_LANGUAGE
): string {
  if (configuredAppLanguage && configuredAppLanguage !== AUTO_LANGUAGE_VALUE) {
    return (
      findSupportedLocale(configuredAppLanguage, SUPPORTED_UI_LANGUAGE_CODES) ||
      fallbackLanguage
    )
  }

  const resolvedUserLanguage = resolveLanguagePreference(
    configuredUserLanguage,
    navigatorLanguages
  )

  return resolveUiLanguageFromUserLanguage(
    resolvedUserLanguage,
    fallbackLanguage
  )
}

/** Locales are BCP 47 tags already; this only normalizes the case */
export function toHtmlLang(locale: string): string {
  return normalizeLocale(locale)
}

export function getLanguageLabelKey(locale: string): string {
  const normalized = normalizeLocale(locale)
  const key = locale === AUTO_LANGUAGE_VALUE ? AUTO_LANGUAGE_VALUE : normalized
  return `language.${key}`
}

export function buildLanguageOptions(
  values: readonly (string | null | undefined)[] = [],
  includeAuto = true,
  translate?: (key: string) => string,
  supportedOptions: readonly {
    id: string
    name: string
  }[] = SUPPORTED_USER_LANGUAGE_OPTIONS
): { id: string; name: string }[] {
  const translateLabel = (value: string, fallbackName: string) => {
    if (!translate) {
      return fallbackName
    }

    const translationKey = getLanguageLabelKey(value)
    const translatedValue = translate(translationKey)

    return translatedValue === translationKey ? fallbackName : translatedValue
  }

  const options: { id: string; name: string }[] = includeAuto
    ? [{ id: AUTO_LANGUAGE_VALUE, name: 'Auto' }, ...supportedOptions].map(
        (option) => ({
          id: option.id,
          name: translateLabel(option.id, option.name),
        })
      )
    : supportedOptions.map((option) => ({
        id: option.id,
        name: translateLabel(option.id, option.name),
      }))

  for (const value of values) {
    if (!value || value === AUTO_LANGUAGE_VALUE) {
      continue
    }

    const normalizedValue = normalizeLocale(value)

    if (options.some((option) => option.id === normalizedValue)) {
      continue
    }

    options.push({
      id: normalizedValue,
      name: translateLabel(normalizedValue, toHtmlLang(normalizedValue)),
    })
  }

  return options
}

export function syncDocumentLanguageAttributes(language?: {
  ui?: string | null
  user?: string | null
}) {
  const navigatorLanguages = getNavigatorLanguages()
  const appLanguage = resolveUiLanguagePreference(
    language?.ui,
    language?.user,
    navigatorLanguages
  )
  const userLanguage = resolveLanguagePreference(
    language?.user,
    navigatorLanguages
  )

  document.documentElement.setAttribute('lang', toHtmlLang(appLanguage))
  document.documentElement.setAttribute('data-app-language', appLanguage)
  document.documentElement.setAttribute('data-user-language', userLanguage)
}
