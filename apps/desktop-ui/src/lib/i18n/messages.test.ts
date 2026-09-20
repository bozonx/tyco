import { describe, expect, it } from 'vitest'

import { DEFAULT_UI_LOCALE, messages } from './messages'

function collectKeys(source: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(source).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return collectKeys(value as Record<string, unknown>, nextKey)
    }

    return [nextKey]
  })
}

describe('i18n messages', () => {
  it('keeps the same translation keys across all locales', () => {
    const baseKeys = collectKeys(messages[DEFAULT_UI_LOCALE])

    for (const [, localeMessages] of Object.entries(messages)) {
      expect(collectKeys(localeMessages as Record<string, unknown>)).toEqual(
        baseKeys
      )
    }
  })
})
