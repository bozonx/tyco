import { describe, expect, it } from 'vitest'

import {
  chatHistoryRetentionChoices,
  isChatHistoryEnabled,
} from './chat-history-settings'

describe('isChatHistoryEnabled', () => {
  it('is on unless the settings turn it off', () => {
    expect(isChatHistoryEnabled(undefined)).toBe(true)
    expect(isChatHistoryEnabled({})).toBe(true)
    expect(isChatHistoryEnabled({ chatHistoryEnabled: true })).toBe(true)
    expect(isChatHistoryEnabled({ chatHistoryEnabled: false })).toBe(false)
  })
})

describe('chatHistoryRetentionChoices', () => {
  it('offers the standard periods', () => {
    expect(chatHistoryRetentionChoices(0)).toEqual([0, 7, 30, 90, 365])
    expect(chatHistoryRetentionChoices(undefined)).toEqual([0, 7, 30, 90, 365])
  })

  it('keeps a saved period that is not offered', () => {
    expect(chatHistoryRetentionChoices(14)).toEqual([0, 7, 14, 30, 90, 365])
  })
})
