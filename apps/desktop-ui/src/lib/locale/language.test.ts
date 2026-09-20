import { describe, expect, it } from 'vitest'

import {
  buildLanguageOptions,
  DEFAULT_LANGUAGE,
  resolveAutoLanguage,
  resolveLanguagePreference,
  resolveUiLanguageFromUserLanguage,
  resolveUiLanguagePreference,
  toHtmlLang,
} from './language'

describe('language helpers', () => {
  it('resolves auto language from navigator languages', () => {
    expect(resolveAutoLanguage(['es-MX', 'en-US'])).toBe('es_ES')
  })

  it('falls back to default language when auto detection misses', () => {
    expect(resolveAutoLanguage(['eo-EO'])).toBe(DEFAULT_LANGUAGE)
  })

  it('normalizes configured language values', () => {
    expect(resolveLanguagePreference('en-us')).toBe('en_US')
  })

  it('maps auto language to the closest supported locale', () => {
    expect(resolveLanguagePreference('auto', ['tr'])).toBe('tr_TR')
  })

  it('converts locale format for html lang', () => {
    expect(toHtmlLang('es_AR')).toBe('es-AR')
  })

  it('adds custom current values to select options', () => {
    expect(buildLanguageOptions(['de_DE']).map((option) => option.id)).toContain(
      'de_DE'
    )
  })

  it('maps user language to the same ui locale when possible', () => {
    expect(resolveUiLanguageFromUserLanguage('tr_TR')).toBe('tr_TR')
  })

  it('maps user language to the first ui locale with the same base language', () => {
    expect(resolveUiLanguageFromUserLanguage('en_GB')).toBe('en_US')
  })

  it('falls back to english ui locale when no ui language matches', () => {
    expect(resolveUiLanguageFromUserLanguage('de_DE')).toBe('en_US')
  })

  it('uses manual ui language when it is explicitly selected', () => {
    expect(resolveUiLanguagePreference('es_AR', 'ru_RU', ['ru-RU'])).toBe(
      'es_AR'
    )
  })

  it('resolves auto ui language from the resolved user language', () => {
    expect(resolveUiLanguagePreference('auto', 'es_ES', ['ru-RU'])).toBe('es_AR')
  })
})
