import { describe, expect, it } from 'vitest'

import { liveLanguageFor } from './live-language'

describe('liveLanguageFor', () => {
  it('leaves languages of the multilingual model to it', () => {
    expect(liveLanguageFor('ru_RU')).toBeUndefined()
    expect(liveLanguageFor('en-GB')).toBeUndefined()
    expect(liveLanguageFor('pt_BR')).toBeUndefined()
  })

  it('names a language the multilingual model does not cover', () => {
    expect(liveLanguageFor('tr_TR')).toBe('tr')
    expect(liveLanguageFor('uk')).toBe('uk')
  })

  it('falls back to the multilingual model without a locale', () => {
    expect(liveLanguageFor(undefined)).toBeUndefined()
    expect(liveLanguageFor('')).toBeUndefined()
  })
})
