import type { ChatHistoryConfig } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  WORKSPACE_DEFAULT,
  isWorkspaceSaving,
  retentionChoice,
  savingChoice,
  withRetention,
  withSaving,
  workspaceRetentionDays,
} from './workspace-history'

const defaults = (value: Partial<ChatHistoryConfig>) =>
  ({ storage: 'disk', ...value }) as ChatHistoryConfig

describe('workspace chat history', () => {
  it('follows the default until the workspace sets its own', () => {
    const off = defaults({ storage: 'off' })
    expect(isWorkspaceSaving({}, off)).toBe(false)
    expect(isWorkspaceSaving({ storage: 'disk' }, off)).toBe(true)
    expect(isWorkspaceSaving({ storage: 'off' }, defaults({}))).toBe(false)
    expect(workspaceRetentionDays({}, defaults({ retentionDays: 30 }))).toBe(30)
    expect(
      workspaceRetentionDays(
        { retentionDays: 0 },
        defaults({ retentionDays: 30 })
      )
    ).toBe(0)
  })

  it('turns choices into settings and back', () => {
    expect(withSaving({ retentionDays: 7 }, 'off')).toEqual({
      retentionDays: 7,
      storage: 'off',
    })
    expect(withSaving({ storage: 'off' }, WORKSPACE_DEFAULT)).toEqual({})
    expect(savingChoice({})).toBe(WORKSPACE_DEFAULT)
    expect(retentionChoice({})).toBe(WORKSPACE_DEFAULT)
    expect(retentionChoice({ retentionDays: 0 })).toBe('0')
  })

  it('tells when a period removes chats kept now', () => {
    const base = defaults({ retentionDays: 90 })
    expect(withRetention({}, base, '30')).toEqual({
      history: { retentionDays: 30 },
      isStricter: true,
    })
    expect(
      withRetention({ retentionDays: 7 }, base, WORKSPACE_DEFAULT)
    ).toEqual({ history: {}, isStricter: false })
    expect(withRetention({}, base, 'x')).toBeNull()
  })
})
