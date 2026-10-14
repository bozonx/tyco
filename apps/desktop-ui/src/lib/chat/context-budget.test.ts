import { describe, expect, it } from 'vitest'

import { resolveContextBudget } from './context-budget'

describe('resolveContextBudget', () => {
  it('sums the texts of the next message', () => {
    expect(resolveContextBudget(['abc', 'de'], 100)).toEqual({
      usedCharacters: 5,
      budgetCharacters: 100,
      usagePercent: 5,
      level: 'ok',
    })
  })

  it('warns from 70% of the budget', () => {
    expect(resolveContextBudget(['x'.repeat(69)], 100).level).toBe('ok')
    expect(resolveContextBudget(['x'.repeat(70)], 100).level).toBe('high')
    expect(resolveContextBudget(['x'.repeat(100)], 100).level).toBe('high')
  })

  it('is over once the message does not fit', () => {
    expect(resolveContextBudget(['x'.repeat(101)], 100)).toMatchObject({
      level: 'over',
      usagePercent: 101,
    })
  })

  it('treats any text as over an empty budget', () => {
    expect(resolveContextBudget([], 0).level).toBe('ok')
    expect(resolveContextBudget(['x'], 0)).toMatchObject({
      level: 'over',
      usagePercent: 100,
    })
  })
})
