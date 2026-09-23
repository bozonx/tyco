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
})
