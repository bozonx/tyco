import { describe, expect, it } from 'vitest'

import {
  DICTATION_LANGUAGE_AUTO,
  dictationLanguageFor,
} from './dictation-language'

describe('dictationLanguageFor', () => {
  it('lets the provider detect the language by default', () => {
    for (const setting of [
      undefined,
      '',
      ' ',
      DICTATION_LANGUAGE_AUTO,
      'multi',
    ])
      expect(dictationLanguageFor(setting)).toBeUndefined()
  })

  it('uses only the language explicitly chosen for dictation', () => {
    expect(dictationLanguageFor('de-DE')).toBe('de')
    expect(dictationLanguageFor('en-GB')).toBe('en')
    expect(dictationLanguageFor('zh-TW')).toBe('zh-TW')
  })
})
