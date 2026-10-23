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
    expect(resolveAutoLanguage(['es-MX', 'en-US'])).toBe('es-ES')
  })

  it('falls back to default language when auto detection misses', () => {
    expect(resolveAutoLanguage(['eo-EO'])).toBe(DEFAULT_LANGUAGE)
  })

  it('normalizes configured language values', () => {
    expect(resolveLanguagePreference('en-us')).toBe('en-US')
  })

  it('maps auto language to the closest supported locale', () => {
    expect(resolveLanguagePreference('auto', ['tr'])).toBe('tr-TR')
  })

  it('converts locale format for html lang', () => {
    expect(toHtmlLang('es-AR')).toBe('es-AR')
  })

  it('adds custom current values to select options', () => {
    expect(
      buildLanguageOptions(['de-DE']).map((option) => option.id)
    ).toContain('de-DE')
  })

  it('maps user language to the same ui locale when possible', () => {
    expect(resolveUiLanguageFromUserLanguage('tr-TR')).toBe('tr-TR')
  })

  it('maps user language to the first ui locale with the same base language', () => {
    expect(resolveUiLanguageFromUserLanguage('en-GB')).toBe('en-US')
  })

  it('falls back to english ui locale when no ui language matches', () => {
    expect(resolveUiLanguageFromUserLanguage('de-DE')).toBe('en-US')
  })

  it('uses manual ui language when it is explicitly selected', () => {
    expect(resolveUiLanguagePreference('es-AR', 'ru-RU', ['ru-RU'])).toBe(
      'es-AR'
    )
  })

  it('resolves auto ui language from the resolved user language', () => {
    expect(resolveUiLanguagePreference('auto', 'es-ES', ['ru-RU'])).toBe(
      'es-AR'
    )
  })
})
