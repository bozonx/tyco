export const AUTO_LANGUAGE_VALUE = 'auto'
const DEFAULT_UI_LANGUAGE = 'en-US'

export const COMMON_LANGUAGE_OPTIONS = [
  { id: 'ru-RU', name: 'Русский' },
  { id: 'en-US', name: 'English (US)' },
  { id: 'en-GB', name: 'English (UK)' },
  { id: 'es', name: 'Español' },
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
  { id: 'cs-CZ', name: 'Čeština' },
  { id: 'hu-HU', name: 'Magyar' },
  { id: 'ro-RO', name: 'Română' },
  { id: 'el-GR', name: 'Ελληνικά' },
  { id: 'hr-HR', name: 'Hrvatski' },
  { id: 'ka-GE', name: 'ქართული' },
  { id: 'kk-KZ', name: 'Қазақ тілі' },
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
  { id: 'en-US', name: 'English (US)' },
  { id: 'ru-RU', name: 'Русский' },
  { id: 'de-DE', name: 'Deutsch' },
  { id: 'fr-FR', name: 'Français' },
  { id: 'es', name: 'Español' },
  { id: 'it-IT', name: 'Italiano' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'pl-PL', name: 'Polski' },
  { id: 'tr-TR', name: 'Türkçe (Türkiye)' },
  { id: 'uk-UA', name: 'Українська' },
  { id: 'cs-CZ', name: 'Čeština' },
  { id: 'hu-HU', name: 'Magyar' },
  { id: 'ro-RO', name: 'Română' },
  { id: 'el-GR', name: 'Ελληνικά' },
  { id: 'hr-HR', name: 'Hrvatski' },
  { id: 'ka-GE', name: 'ქართული' },
  { id: 'kk-KZ', name: 'Қазақ тілі' },
  { id: 'zh-CN', name: '中文 (简体)' },
  { id: 'zh-TW', name: '中文 (繁體)' },
  { id: 'ja-JP', name: '日本語' },
  { id: 'ko-KR', name: '한국어' },
] as const

const SUPPORTED_UI_LANGUAGE_CODES: readonly string[] =
  SUPPORTED_UI_LANGUAGE_OPTIONS.map((option) => option.id)

export function normalizeLocale(locale?: string | null): string {
  if (!locale) return DEFAULT_UI_LANGUAGE
  try {
    return (
      Intl.getCanonicalLocales(locale.trim().replaceAll('_', '-'))[0] ??
      DEFAULT_UI_LANGUAGE
    )
  } catch {
    return locale.trim()
  }
}

function findSupportedLocale(locale: string): string | undefined {
  const normalized = normalizeLocale(locale)
  if (SUPPORTED_UI_LANGUAGE_CODES.includes(normalized)) return normalized
  const language = normalized.split('-')[0]
  return (
    SUPPORTED_UI_LANGUAGE_CODES.find((id) => id === language) ??
    SUPPORTED_UI_LANGUAGE_CODES.find((id) => id.split('-')[0] === language)
  )
}

export function getNavigatorLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length
    ? [...navigator.languages]
    : navigator.language
      ? [navigator.language]
      : []
}

/** Interface preferences never influence speech recognition. */
export function resolveUiLanguagePreference(
  configuredAppLanguage?: string | null,
  navigatorLanguages: readonly string[] = getNavigatorLanguages(),
  fallbackLanguage = DEFAULT_UI_LANGUAGE
): string {
  if (configuredAppLanguage && configuredAppLanguage !== AUTO_LANGUAGE_VALUE)
    return findSupportedLocale(configuredAppLanguage) ?? fallbackLanguage
  for (const locale of navigatorLanguages) {
    const match = findSupportedLocale(locale)
    if (match) return match
  }
  return fallbackLanguage
}

export function toHtmlLang(locale: string): string {
  return normalizeLocale(locale)
}

export function getLanguageLabelKey(locale: string): string {
  return `language.${normalizeLocale(locale)}`
}

export function buildLanguageOptions(
  values: readonly (string | null | undefined)[] = [],
  includeAuto = true,
  translate?: (key: string) => string,
  supportedOptions: readonly {
    id: string
    name: string
  }[] = SUPPORTED_UI_LANGUAGE_OPTIONS
): { id: string; name: string }[] {
  const options = includeAuto
    ? [{ id: AUTO_LANGUAGE_VALUE, name: 'Auto' }, ...supportedOptions]
    : [...supportedOptions]
  for (const value of values) {
    if (!value || value === AUTO_LANGUAGE_VALUE) continue
    const id = normalizeLocale(value)
    if (!options.some((option) => option.id === id))
      options.push({ id, name: id })
  }
  return options.map(({ id, name }) => ({
    id,
    name: translate ? translate(getLanguageLabelKey(id)) : name,
  }))
}

const RTL_LANGUAGES = new Set(['ar', 'fa', 'ur', 'he', 'ps', 'yi', 'ug'])

export function isRtlLanguage(code?: string | null): boolean {
  if (!code) return false
  const base = code.split(/[-_]/)[0]?.toLowerCase() ?? ''
  return RTL_LANGUAGES.has(base)
}

export function syncDocumentLanguageAttributes(language?: {
  ui?: string | null
}) {
  const appLanguage = resolveUiLanguagePreference(language?.ui)
  document.documentElement.setAttribute('lang', toHtmlLang(appLanguage))
  document.documentElement.setAttribute('data-app-language', appLanguage)
  document.documentElement.setAttribute(
    'dir',
    isRtlLanguage(appLanguage) ? 'rtl' : 'ltr'
  )
}
