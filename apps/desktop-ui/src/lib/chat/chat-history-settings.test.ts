import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  chatHistoryRetentionChoices,
  isChatHistoryOnDisk,
  isQuickRequestSavingEnabled,
} from './chat-history-settings'

const withHistory = (
  history: (typeof DEFAULT_USER_CONFIG)['chat']['history']
): typeof DEFAULT_USER_CONFIG => ({ ...DEFAULT_USER_CONFIG, chat: { history } })

describe('isChatHistoryOnDisk', () => {
  it('is on disk unless the settings keep chats in memory', () => {
    expect(isChatHistoryOnDisk(DEFAULT_USER_CONFIG)).toBe(true)
    expect(isChatHistoryOnDisk(withHistory({ storage: 'session' }))).toBe(false)
  })

  it('lets the workspace of a profile chat decide alone', () => {
    const session = withHistory({ storage: 'session' })
    expect(isChatHistoryOnDisk(session, 'writer', {})).toBe(true)
    expect(
      isChatHistoryOnDisk(DEFAULT_USER_CONFIG, 'writer', { storage: 'session' })
    ).toBe(false)
    // "Ask AI" has no workspace
    expect(isChatHistoryOnDisk(session, null, { storage: 'disk' })).toBe(false)
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
    expect(isQuickRequestSavingEnabled(config, null)).toBe(false)
    expect(isQuickRequestSavingEnabled(config, 'writer', {})).toBe(true)
    expect(
      isQuickRequestSavingEnabled(DEFAULT_USER_CONFIG, 'writer', {
        isQuickRequestSavingEnabled: false,
      })
    ).toBe(false)
  })
})
