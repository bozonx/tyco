export const AUTO_LANGUAGE_VALUE = 'auto'
export const DEFAULT_LANGUAGE = 'ru_RU'
export const DEFAULT_UI_LANGUAGE = 'en_US'

export const SUPPORTED_USER_LANGUAGE_OPTIONS = [
  { id: 'ru_RU', name: 'Русский' },
  { id: 'en_US', name: 'English (US)' },
  { id: 'en_GB', name: 'English (UK)' },
  { id: 'es_ES', name: 'Español (España)' },
  { id: 'es_AR', name: 'Español (Argentina)' },
  { id: 'pt_BR', name: 'Português (Brasil)' },
  { id: 'pt_PT', name: 'Português (Portugal)' },
  { id: 'de_DE', name: 'Deutsch' },
  { id: 'fr_FR', name: 'Français' },
  { id: 'it_IT', name: 'Italiano' },
  { id: 'nl_NL', name: 'Nederlands' },
  { id: 'pl_PL', name: 'Polski' },
  { id: 'uk_UA', name: 'Українська' },
  { id: 'tr_TR', name: 'Türkçe (Türkiye)' },
  { id: 'ar_SA', name: 'العربية' },
  { id: 'hi_IN', name: 'हिन्दी' },
  { id: 'bn_BD', name: 'বাংলা' },
  { id: 'ur_PK', name: 'اردو' },
  { id: 'fa_IR', name: 'فارسی' },
  { id: 'he_IL', name: 'עברית' },
  { id: 'zh_CN', name: '中文 (简体)' },
  { id: 'zh_TW', name: '中文 (繁體)' },
  { id: 'ja_JP', name: '日本語' },
  { id: 'ko_KR', name: '한국어' },
  { id: 'vi_VN', name: 'Tiếng Việt' },
  { id: 'th_TH', name: 'ไทย' },
  { id: 'id_ID', name: 'Bahasa Indonesia' },
  { id: 'ms_MY', name: 'Bahasa Melayu' },
] as const

export const USER_LANGUAGE_OPTIONS = [
  { id: AUTO_LANGUAGE_VALUE, name: 'Авто' },
  ...SUPPORTED_USER_LANGUAGE_OPTIONS,
] as const

export const SUPPORTED_UI_LANGUAGE_OPTIONS = [
  { id: 'ru_RU', name: 'Русский' },
  { id: 'en_US', name: 'English (US)' },
  { id: 'es_AR', name: 'Español (Argentina)' },
  { id: 'tr_TR', name: 'Türkçe (Türkiye)' },
] as const

const SUPPORTED_USER_LANGUAGE_CODES: readonly string[] =
  SUPPORTED_USER_LANGUAGE_OPTIONS.map((option) => option.id)

const SUPPORTED_UI_LANGUAGE_CODES: readonly string[] =
  SUPPORTED_UI_LANGUAGE_OPTIONS.map((option) => option.id)

function splitLocale(locale: string) {
  return locale
    .trim()
    .replace(/-/g, '_')
    .split('_')
    .filter(Boolean)
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

  return `${language.toLowerCase()}_${region.toUpperCase()}`
}

function findSupportedLocale(
  locale: string,
  supportedLocales: readonly string[]
): string | null {
  const normalized = normalizeLocale(locale)

  if (supportedLocales.includes(normalized)) {
    return normalized
  }

  const [language] = normalized.split('_')

  return (
    supportedLocales.find((supportedLocale) =>
      supportedLocale.startsWith(`${language}_`)
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

  const [language] = normalizedUserLanguage.split('_')
  const partialMatch = SUPPORTED_UI_LANGUAGE_CODES.find((supportedLocale) =>
    supportedLocale.startsWith(`${language}_`)
  )

  return partialMatch || fallbackLanguage
}

export function resolveUiLanguagePreference(
  configuredAppLanguage?: string | null,
  configuredUserLanguage?: string | null,
  navigatorLanguages: readonly string[] = getNavigatorLanguages(),
  fallbackLanguage = DEFAULT_UI_LANGUAGE
): string {
  if (
    configuredAppLanguage &&
    configuredAppLanguage !== AUTO_LANGUAGE_VALUE
  ) {
    return (
      findSupportedLocale(configuredAppLanguage, SUPPORTED_UI_LANGUAGE_CODES) ||
      fallbackLanguage
    )
  }

  const resolvedUserLanguage = resolveLanguagePreference(
    configuredUserLanguage,
    navigatorLanguages
  )

  return resolveUiLanguageFromUserLanguage(resolvedUserLanguage, fallbackLanguage)
}

export function toHtmlLang(locale: string): string {
  return normalizeLocale(locale).replace(/_/g, '-')
}

export function getLanguageLabel(locale: string): string {
  const normalized = normalizeLocale(locale)
  const key = locale === AUTO_LANGUAGE_VALUE ? AUTO_LANGUAGE_VALUE : normalized
  return `language.${key}`
}

export function buildLanguageOptions(
  values: readonly (string | null | undefined)[] = [],
  includeAuto = true,
  translate?: (key: string) => string,
  supportedOptions: readonly { id: string; name: string }[] = SUPPORTED_USER_LANGUAGE_OPTIONS
): { id: string; name: string }[] {
  const translateLabel = (value: string, fallbackName: string) => {
    if (!translate) {
      return fallbackName
    }

    const translationKey = getLanguageLabel(value)
    const translatedValue = translate(translationKey)

    return translatedValue === translationKey ? fallbackName : translatedValue
  }

  const options: { id: string; name: string }[] = includeAuto
    ? [
      { id: AUTO_LANGUAGE_VALUE, name: 'Авто' },
      ...supportedOptions,
    ].map((option) => ({
      id: option.id,
      name: translateLabel(option.id, option.name),
    }))
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

export function syncDocumentLanguageAttributes(userConfig?: {
  appLanguage?: string | null
  userLanguage?: string | null
}) {
  const navigatorLanguages = getNavigatorLanguages()
  const appLanguage = resolveUiLanguagePreference(
    userConfig?.appLanguage,
    userConfig?.userLanguage,
    navigatorLanguages
  )
  const userLanguage = resolveLanguagePreference(userConfig?.userLanguage, navigatorLanguages)

  document.documentElement.setAttribute('lang', toHtmlLang(appLanguage))
  document.documentElement.setAttribute('data-app-language', appLanguage)
  document.documentElement.setAttribute('data-user-language', userLanguage)
}
