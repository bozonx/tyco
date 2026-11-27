import { describe, expect, it } from 'vitest'

import { pluralKey } from './plural'

const keys = { one: 'one', few: 'few', many: 'many', other: 'other' }

describe('pluralKey', () => {
  it('picks the form of the count in the locale', () => {
    expect([1, 3, 5, 21].map((n) => pluralKey(keys, n, 'ru-RU'))).toEqual([
      'one',
      'few',
      'many',
      'one',
    ])
    expect([1, 2].map((n) => pluralKey(keys, n, 'en-US'))).toEqual([
      'one',
      'other',
    ])
    expect(pluralKey(keys, 1, 'ja-JP')).toBe('other')
  })
})
