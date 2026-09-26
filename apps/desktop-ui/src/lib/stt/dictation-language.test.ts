import { describe, expect, it } from 'vitest'

import {
  DICTATION_LANGUAGE_MULTI,
  DICTATION_LANGUAGE_USER,
  dictationLanguageFor,
} from './dictation-language'

describe('dictationLanguageFor', () => {
  it('names the user language by default', () => {
    expect(dictationLanguageFor(undefined, 'ru_RU')).toBe('ru')
    expect(dictationLanguageFor('', 'en-GB')).toBe('en')
    expect(dictationLanguageFor(DICTATION_LANGUAGE_USER, 'tr_TR')).toBe('tr')
  })

  it('uses the language chosen for dictation', () => {
    expect(dictationLanguageFor('de_DE', 'ru_RU')).toBe('de')
    expect(dictationLanguageFor('zh_TW', 'ru_RU')).toBe('zh-TW')
  })

  it('leaves the multilingual model to follow the speech', () => {
    expect(dictationLanguageFor(DICTATION_LANGUAGE_MULTI, 'ru_RU')).toBe(
      undefined
    )
  })

  it('falls back to the multilingual model without any locale', () => {
    expect(dictationLanguageFor(undefined, undefined)).toBeUndefined()
    expect(dictationLanguageFor(undefined, ' ')).toBeUndefined()
  })
})
