import { describe, expect, it } from 'vitest'
import { historyRetentionChoices } from './history-retention'

describe('history retention choices', () => {
  const defaults = [0, 7, 30, 90] as const
  it('includes and sorts a saved custom period without mutating defaults', () => {
    expect(historyRetentionChoices(defaults, '14')).toEqual([0, 7, 14, 30, 90])
    expect(defaults).toEqual([0, 7, 30, 90])
  })
  it.each([undefined, null, '', 'invalid', -1, 1.5, Infinity, 0, 7])(
    'ignores invalid or existing periods: %s',
    (saved) => {
      expect(historyRetentionChoices(defaults, saved)).toEqual(defaults)
    }
  )
})
