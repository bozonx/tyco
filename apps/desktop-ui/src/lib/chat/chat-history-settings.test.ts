import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  chatHistoryConfig,
  chatHistoryRetentionChoices,
  isChatHistoryEnabled,
  isQuickRequestSavingEnabled,
} from './chat-history-settings'

const withHistory = (
  askAi: 'off' | 'disk',
  profiles: 'off' | 'disk'
): typeof DEFAULT_USER_CONFIG => ({
  ...DEFAULT_USER_CONFIG,
  chat: { history: { storage: askAi } },
  aiProfiles: { chatHistory: { storage: profiles, retentionDays: 7 } },
})

describe('isChatHistoryEnabled', () => {
  it('is on unless the settings turn it off', () => {
    expect(isChatHistoryEnabled(DEFAULT_USER_CONFIG)).toBe(true)
    expect(
      isChatHistoryEnabled({
        ...DEFAULT_USER_CONFIG,
        chat: {
          ...DEFAULT_USER_CONFIG.chat,
          history: { ...DEFAULT_USER_CONFIG.chat.history, storage: 'disk' },
        },
      })
    ).toBe(true)
    expect(
      isChatHistoryEnabled({
        ...DEFAULT_USER_CONFIG,
        chat: {
          ...DEFAULT_USER_CONFIG.chat,
          history: { ...DEFAULT_USER_CONFIG.chat.history, storage: 'off' },
        },
      })
    ).toBe(false)
    expect(
      isChatHistoryEnabled({
        ...DEFAULT_USER_CONFIG,
        chat: {
          ...DEFAULT_USER_CONFIG.chat,
          history: {
            ...DEFAULT_USER_CONFIG.chat.history,
            storage: 'disk',
            isChatSavingEnabled: false,
          },
        },
      })
    ).toBe(false)
  })

  it('reads the profile settings for a profile chat only', () => {
    expect(isChatHistoryEnabled(withHistory('disk', 'off'))).toBe(true)
    expect(isChatHistoryEnabled(withHistory('disk', 'off'), null)).toBe(true)
    expect(isChatHistoryEnabled(withHistory('disk', 'off'), 'writer')).toBe(
      false
    )
    expect(isChatHistoryEnabled(withHistory('off', 'disk'), 'writer')).toBe(
      true
    )
  })
})

describe('chatHistoryConfig', () => {
  it('picks the settings of the scope', () => {
    const config = withHistory('off', 'disk')
    expect(chatHistoryConfig(config, 'askAi')).toEqual({ storage: 'off' })
    expect(chatHistoryConfig(config, 'profiles')).toEqual({
      storage: 'disk',
      retentionDays: 7,
    })
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
  it('saves quick requests unless their scope turns it off', () => {
    expect(isQuickRequestSavingEnabled(DEFAULT_USER_CONFIG)).toBe(true)
    const config = {
      ...DEFAULT_USER_CONFIG,
      aiProfiles: {
        ...DEFAULT_USER_CONFIG.aiProfiles,
        chatHistory: {
          ...DEFAULT_USER_CONFIG.aiProfiles.chatHistory,
          isQuickRequestSavingEnabled: false,
        },
      },
    }
    expect(isQuickRequestSavingEnabled(config, 'writer')).toBe(false)
    expect(isQuickRequestSavingEnabled(config, null)).toBe(true)
    expect(
      isQuickRequestSavingEnabled({
        ...DEFAULT_USER_CONFIG,
        chat: {
          ...DEFAULT_USER_CONFIG.chat,
          history: {
            ...DEFAULT_USER_CONFIG.chat.history,
            storage: 'disk',
            isChatSavingEnabled: false,
            isQuickRequestSavingEnabled: true,
          },
        },
      })
    ).toBe(true)
    expect(
      isQuickRequestSavingEnabled({
        ...DEFAULT_USER_CONFIG,
        chat: {
          ...DEFAULT_USER_CONFIG.chat,
          history: {
            ...DEFAULT_USER_CONFIG.chat.history,
            storage: 'off',
            isQuickRequestSavingEnabled: true,
          },
        },
      })
    ).toBe(false)
  })
})
