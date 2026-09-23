import { describe, expect, it } from 'vitest'

import { protectTranslationText } from './protected-text'

describe('protectTranslationText', () => {
  it('restores code, links and placeholders after machine translation', () => {
    const source =
      'Open `code` at https://example.com for {{name}}.\n```ts\nx()\n```'
    const protectedText = protectTranslationText(source)

    expect(protectedText.text).not.toContain('https://example.com')
    expect(
      protectedText.restore(protectedText.text.replace('Open', 'Откройте'))
    ).toBe(
      'Откройте `code` at https://example.com for {{name}}.\n```ts\nx()\n```'
    )
  })
})
