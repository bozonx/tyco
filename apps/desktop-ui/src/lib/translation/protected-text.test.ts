import { describe, expect, it } from 'vitest'

import { protectTranslationText } from './protected-text'

describe('protectTranslationText', () => {
  it('restores code, links, markup and placeholders after machine translation', () => {
    const source =
      'Open `code` at https://example.com for {{name}}, {count}, %s and <b>${value}</b>.\n```ts\nx()\n```'
    const protectedText = protectTranslationText(source)

    expect(protectedText.text).not.toContain('https://example.com')
    expect(
      protectedText.restore(protectedText.text.replace('Open', 'Откройте'))
    ).toBe(
      'Откройте `code` at https://example.com for {{name}}, {count}, %s and <b>${value}</b>.\n```ts\nx()\n```'
    )
  })

  it('protects binding terms and restores their original spelling', () => {
    const protectedText = protectTranslationText('Use TyCo and tyco.', ['TyCo'])

    expect(
      protectedText.restore(protectedText.text.replace('Use', 'Используйте'))
    ).toBe('Используйте TyCo and tyco.')
  })

  it('rejects a result that changed a protected token', () => {
    const protectedText = protectTranslationText('Hello {{name}}')

    expect(() => protectedText.restore('Привет')).toThrow(
      'Translation changed 1 protected token(s)'
    )
  })

  it('protects binding terms with case sensitivity', () => {
    const protectedText = protectTranslationText('Use Apple and apple.', [
      'Apple',
    ])
    expect(protectedText.text).toContain('apple')
    expect(protectedText.text).not.toContain('Apple')
    expect(
      protectedText.restore(protectedText.text.replace('Use', 'Используйте'))
    ).toBe('Используйте Apple and apple.')
  })

  it('tolerates casing and whitespace variations in protected tokens from MT', () => {
    const protectedText = protectTranslationText('Hello {{name}}')
    expect(protectedText.restore('Привет __ tyco_protected_0 __')).toBe(
      'Привет {{name}}'
    )
    expect(protectedText.restore('Привет __TYCO_PROTECTED_ 0 __')).toBe(
      'Привет {{name}}'
    )
    expect(protectedText.restore('Привет __ TYCO _ PROTECTED _ 0 __')).toBe(
      'Привет {{name}}'
    )
    expect(protectedText.restore('Привет __TYCO_PROTECTED_0 _ _')).toBe(
      'Привет {{name}}'
    )
  })

  it('does not protect percentage in normal words or angle bracket comparisons', () => {
    const text = 'Get 20%off and 100%sure if a <b or c> d'
    const protectedText = protectTranslationText(text)
    expect(protectedText.text).toBe(text)
  })
})

it('round-trips source text that already contains a marker prefix', () => {
  const source = '__TYCO_PROTECTED_0__ `code`'
  const protectedText = protectTranslationText(source)
  expect(protectedText.restore(protectedText.text)).toBe(source)
})

it('rejects duplicate protected tokens', () => {
  const protectedText = protectTranslationText('Use `code`')
  expect(() =>
    protectedText.restore(`${protectedText.text} __TYCO_PROTECTED_0__`)
  ).toThrow('Translation changed')
})
