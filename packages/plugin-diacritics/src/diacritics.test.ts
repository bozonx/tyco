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
    expect(clearDiacritics('\u0451 \u0439 \u00f1 \u00e1')).toBe(
      '\u0435 \u0438 n a'
    )
  })
  it('preserves emoji variation selectors when clearing', () => {
    expect(clearDiacritics('\u2764\ufe0f \u00e1')).toBe('\u2764\ufe0f a')
  })
})
