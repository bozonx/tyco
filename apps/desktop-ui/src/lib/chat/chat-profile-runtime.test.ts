import { describe, expect, it, vi } from 'vitest'

import { createChatProfileRuntime } from './chat-profile-runtime'

describe('createChatProfileRuntime', () => {
  it('loads chat history and soul once during preparation and retries after a failure', async () => {
    const loadChatHistory = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Disk busy'))
      .mockResolvedValue(undefined)
    const refreshProfile = vi.fn(async () => undefined)
    const readSoul = vi.fn(async () => 'You are a concise writer.')
    const warn = vi.fn()

    const runtime = createChatProfileRuntime({
      profileId: 'writer',
      loadChatHistory,
      refreshProfile,
      readSoul,
      warn,
    })

    await runtime.prepareProfile()
    expect(warn).toHaveBeenCalledOnce()
    expect(loadChatHistory).toHaveBeenCalledTimes(1)

    await runtime.prepareProfile()
    await runtime.prepareProfile()
    expect(loadChatHistory).toHaveBeenCalledTimes(2)
    expect(runtime.soul.value).toBe('You are a concise writer.')
  })

  it('no-ops when profileId is null', async () => {
    const loadChatHistory = vi.fn(async () => {})
    const refreshProfile = vi.fn(async () => undefined)
    const readSoul = vi.fn(async () => '')
    const warn = vi.fn()

    const runtime = createChatProfileRuntime({
      profileId: null,
      loadChatHistory,
      refreshProfile,
      readSoul,
      warn,
    })

    await runtime.prepareProfile()
    expect(await runtime.refreshProfile()).toBeUndefined()
    expect(loadChatHistory).not.toHaveBeenCalled()
    expect(refreshProfile).not.toHaveBeenCalled()
    expect(readSoul).not.toHaveBeenCalled()
  })
})
