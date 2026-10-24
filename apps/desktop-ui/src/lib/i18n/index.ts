import { createI18n } from 'vue-i18n'

import { resolveUiLanguagePreference, toHtmlLang } from '../locale/language'
import { DEFAULT_UI_LOCALE, type UiLocale, messages } from './messages'

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_UI_LOCALE,
  fallbackLocale: false,
  messages,
  missingWarn: false,
  ...(import.meta.env.MODE === 'browser-test'
    ? {
        missing: (locale: string, key: string) => {
          // eslint-disable-next-line no-console -- Browser tests must reject missing translations.
          console.error(`[intlify] Missing translation in ${locale}: ${key}`)
        },
      }
    : {}),
  fallbackWarn: false,
})

type GlobalI18n = {
  locale: { value: UiLocale }
  t: (key: string, params?: Record<string, string | number>) => string
}

const globalI18n = i18n.global as GlobalI18n

function resolveUiLocale(configuredAppLanguage?: string | null): UiLocale {
  const resolved = resolveUiLanguagePreference(configuredAppLanguage)
  return (resolved in messages ? resolved : DEFAULT_UI_LOCALE) as UiLocale
}

export function setI18nLocale(locale: UiLocale) {
  globalI18n.locale.value = locale

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', toHtmlLang(locale))
  }
}

export function syncI18nLocale(
  configuredAppLanguage?: string | null
): UiLocale {
  const locale = resolveUiLocale(configuredAppLanguage)
  setI18nLocale(locale)
  return locale
}

export function translate(
  key: string,
  params?: Record<string, string | number>
): string {
  return globalI18n.t(key, params)
}
