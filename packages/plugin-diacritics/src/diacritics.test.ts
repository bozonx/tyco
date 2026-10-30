import { describe, expect, it } from 'vitest'
import { addDiacritic, clearAcute, clearDiacritics } from './diacritics.js'

describe('manual diacritics', () => {
  it('handles decomposed and precomposed letters without duplicate marks', () => {
    expect(addDiacritic('a\u0301 \u00e1 \u0430\u0301 \u0430', 'acute')).toBe(
      '\u00e1 \u00e1 \u0430\u0301 \u0430\u0301'
    )
    expect(addDiacritic(addDiacritic('a', 'acute'), 'acute')).toBe('\u00e1')
  })
  it('applies to selected letters only, keeping whitespace and punctuation', () => {
    expect(addDiacritic(' a! 1\n', 'circumflex')).toBe(' \u00e2! 1\n')
    expect(addDiacritic('n', 'tilde')).toBe('\u00f1')
  })
  it('offers selective stress removal and explicit full clearing', () => {
    expect(clearAcute('\u0451 \u0439 \u00f1 \u00e1 \u0430\u0301')).toBe(
      '\u0451 \u0439 \u00f1 a \u0430'
    )
    expect(clearDiacritics('\u00f1 \u00e1 \u00e7 \u0161 \u03ac')).toBe(
      'n a c s \u03b1'
    )
  })
  it('keeps Cyrillic letters and removes only their stress', () => {
    expect(
      clearDiacritics('\u0451 \u0439 \u0457 \u045e \u0430\u0301 \u0435\u0300')
    ).toBe('\u0451 \u0439 \u0457 \u045e \u0430 \u0435')
  })
  it('keeps spacing characters that Unicode counts as diacritics', () => {
    expect(clearDiacritics('a^b `code` \u00a8 \u00b4 ~ \u00b7')).toBe(
      'a^b `code` \u00a8 \u00b4 ~ \u00b7'
    )
  })
  it('keeps the voiced kana of Japanese', () => {
    expect(clearDiacritics('\u304c \u30d1')).toBe('\u304c \u30d1')
  })
  it('preserves emoji variation selectors when clearing', () => {
    expect(clearDiacritics('\u2764\ufe0f \u00e1')).toBe('\u2764\ufe0f a')
  })
})
