import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  chatHistoryRetentionChoices,
  isChatHistoryEnabled,
  isQuickRequestSavingEnabled,
} from './chat-history-settings'

const withHistory = (
  history: (typeof DEFAULT_USER_CONFIG)['chat']['history']
): typeof DEFAULT_USER_CONFIG => ({ ...DEFAULT_USER_CONFIG, chat: { history } })

describe('isChatHistoryEnabled', () => {
  it('is on unless the settings turn it off', () => {
    expect(isChatHistoryEnabled(DEFAULT_USER_CONFIG)).toBe(true)
    expect(isChatHistoryEnabled(withHistory({ storage: 'disk' }))).toBe(true)
    expect(isChatHistoryEnabled(withHistory({ storage: 'off' }))).toBe(false)
  })

  it('lets the workspace of a profile chat decide over the chat settings', () => {
    const off = withHistory({ storage: 'off' })
    expect(isChatHistoryEnabled(off, 'writer')).toBe(false)
    expect(isChatHistoryEnabled(off, 'writer', { storage: 'disk' })).toBe(true)
    expect(
      isChatHistoryEnabled(withHistory({ storage: 'disk' }), 'writer', {
        storage: 'off',
      })
    ).toBe(false)
    // "Ask AI" has no workspace
    expect(isChatHistoryEnabled(off, null, { storage: 'disk' })).toBe(false)
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

describe('isQuickRequestSavingEnabled', () => {
  it('saves quick requests unless the settings turn it off', () => {
    expect(isQuickRequestSavingEnabled(DEFAULT_USER_CONFIG)).toBe(true)
    const config = withHistory({
      storage: 'disk',
      isQuickRequestSavingEnabled: false,
    })
    expect(isQuickRequestSavingEnabled(config, 'writer')).toBe(false)
    expect(isQuickRequestSavingEnabled(config, null)).toBe(false)
    expect(
      isQuickRequestSavingEnabled(
        withHistory({ storage: 'off', isQuickRequestSavingEnabled: true })
      )
    ).toBe(false)
  })
})
