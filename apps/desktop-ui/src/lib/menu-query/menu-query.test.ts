import { describe, expect, it } from 'vitest'

import {
  filterOptions,
  moveHighlight,
  pushRecent,
  uniqueIds,
} from './menu-query'

const languages = [
  { id: 'en_US', label: 'English', keywords: ['English (US)'] },
  { id: 'de_DE', label: 'German', keywords: ['Deutsch'] },
  { id: 'fr_FR', label: 'French', keywords: ['Français'] },
]

describe('filterOptions', () => {
  it('keeps every option for an empty query', () => {
    expect(filterOptions(languages, '  ')).toEqual(languages)
  })

  it('puts prefix matches before inner ones and finds by keywords', () => {
    expect(filterOptions(languages, 'en').map((o) => o.id)).toEqual([
      'en_US',
      'fr_FR',
    ])
    expect(filterOptions(languages, 'deu').map((o) => o.id)).toEqual(['de_DE'])
    expect(filterOptions(languages, 'FR').map((o) => o.id)).toEqual(['fr_FR'])
  })
})

describe('moveHighlight', () => {
  it('wraps at both ends and starts from nothing highlighted', () => {
    expect(moveHighlight(-1, 1, 3)).toBe(0)
    expect(moveHighlight(-1, -1, 3)).toBe(2)
    expect(moveHighlight(2, 1, 3)).toBe(0)
    expect(moveHighlight(0, -1, 3)).toBe(2)
    expect(moveHighlight(0, 1, 0)).toBe(-1)
  })
})

describe('pushRecent', () => {
  it('moves a repeated item on top and keeps the limit', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b'], 'c', 2)).toEqual(['c', 'a'])
    expect(pushRecent(undefined, ' x ')).toEqual(['x'])
    expect(pushRecent(['a'], '  ')).toEqual(['a'])
  })
})

describe('uniqueIds', () => {
  it('keeps the first copy of each id', () => {
    expect(
      uniqueIds([
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
        { id: 'a', n: 3 },
      ])
    ).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ])
  })
})
