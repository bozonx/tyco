import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  chatHistoryRetentionChoices,
  isChatHistoryEnabled,
} from './chat-history-settings'

describe('isChatHistoryEnabled', () => {
  it('is on unless the settings turn it off', () => {
    expect(isChatHistoryEnabled(DEFAULT_USER_CONFIG)).toBe(true)
    expect(
      isChatHistoryEnabled({
        chat: { ...DEFAULT_USER_CONFIG.chat, isHistoryEnabled: true },
      })
    ).toBe(true)
    expect(
      isChatHistoryEnabled({
        chat: { ...DEFAULT_USER_CONFIG.chat, isHistoryEnabled: false },
      })
    ).toBe(false)
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
