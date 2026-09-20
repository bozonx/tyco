import { createI18n } from 'vue-i18n'

import { resolveUiLanguagePreference } from '../locale/language'
import { DEFAULT_UI_LOCALE, type UiLocale, messages } from './messages'

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_UI_LOCALE,
  fallbackLocale: DEFAULT_UI_LOCALE,
  messages,
})

type GlobalI18n = {
  locale: { value: UiLocale }
  t: (key: string, params?: Record<string, string | number>) => string
}

const globalI18n = i18n.global as GlobalI18n

export function resolveUiLocale(
  configuredAppLanguage?: string | null,
  configuredUserLanguage?: string | null
): UiLocale {
  const resolved = resolveUiLanguagePreference(
    configuredAppLanguage,
    configuredUserLanguage
  )
  return (resolved in messages ? resolved : DEFAULT_UI_LOCALE) as UiLocale
}

export function setI18nLocale(locale: UiLocale) {
  globalI18n.locale.value = locale
}

export function syncI18nLocale(
  configuredAppLanguage?: string | null,
  configuredUserLanguage?: string | null
): UiLocale {
  const locale = resolveUiLocale(configuredAppLanguage, configuredUserLanguage)
  setI18nLocale(locale)
  return locale
}

export function translate(
  key: string,
  params?: Record<string, string | number>
): string {
  return globalI18n.t(key, params)
}
