import { describe, expect, it } from 'vitest'

import { createRangeIndex } from './range-index'

describe('createRangeIndex', () => {
  const index = createRangeIndex([
    { from: 20, to: 30 },
    { from: 0, to: 10 },
    { from: 22, to: 25 },
  ])

  it('finds ranges sharing a character', () => {
    expect(index.overlaps(9, 12)).toBe(true)
    expect(index.overlaps(10, 20)).toBe(false)
    expect(index.overlaps(29, 40)).toBe(true)
    expect(index.overlaps(30, 40)).toBe(false)
  })

  it('finds a range covering another and reaching beyond it', () => {
    expect(index.containsStrictly(22, 25)).toBe(true)
    expect(index.containsStrictly(20, 30)).toBe(false)
    expect(index.containsStrictly(0, 10)).toBe(false)
    expect(index.containsStrictly(0, 5)).toBe(true)
    expect(index.containsStrictly(5, 10)).toBe(true)
    expect(index.containsStrictly(15, 18)).toBe(false)
  })
})
