import { describe, expect, it } from 'vitest'

import {
  normalizeLocale,
  resolveUiLanguagePreference,
  toHtmlLang,
} from './language'

describe('interface language', () => {
  it('uses the system preferences in order in automatic mode', () => {
    expect(
      resolveUiLanguagePreference('auto', ['nl-NL', 'es-MX', 'en-US'])
    ).toBe('es')
    expect(resolveUiLanguagePreference('auto', ['de-AT', 'en-US'])).toBe(
      'de-DE'
    )
  })

  it('uses English when no system language has a UI translation', () => {
    expect(resolveUiLanguagePreference('auto', ['eo'])).toBe('en-US')
  })

  it('respects an explicitly selected interface language', () => {
    expect(resolveUiLanguagePreference('ka-GE', ['ru-RU'])).toBe('ka-GE')
    expect(resolveUiLanguagePreference('es-AR', ['ru-RU'])).toBe('es')
  })

  it('normalizes language, script and region without corrupting script tags', () => {
    expect(normalizeLocale('en_us')).toBe('en-US')
    expect(normalizeLocale('zh-hant')).toBe('zh-Hant')
    expect(toHtmlLang('es-AR')).toBe('es-AR')
  })
})
