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

  it('loads memory and combines soul with memory block', async () => {
    const profile = {
      id: 'doc',
      name: 'Doctor',
      memoryMode: 'auto' as const,
      createdAt: 1,
      updatedAt: 1,
      projectPermissions: {},
    }
    const refreshProfile = vi.fn(async () => profile)
    const readSoul = vi.fn(async () => 'You are a doctor.')
    const readCoreMemory = vi.fn(async () => '# Core\n- Patient info')
    const listMemoryTopics = vi.fn(async () => [
      { file: 'health.md', title: 'Health', bytes: 120, updatedAt: 1 },
    ])
    const warn = vi.fn()

    const runtime = createChatProfileRuntime({
      profileId: 'doc',
      loadChatHistory: async () => {},
      refreshProfile,
      readSoul,
      readCoreMemory,
      listMemoryTopics,
      warn,
    })

    await runtime.prepareProfile()
    expect(runtime.soul.value).toBe('You are a doctor.')
    expect(runtime.memoryBlock.value).toContain('<profile_memory>')
    expect(runtime.memoryBlock.value).toContain('# Core\n- Patient info')
    expect(runtime.memoryBlock.value).toContain('health.md')
    expect(runtime.fullInstructions.value).toBe(
      `You are a doctor.\n\n${runtime.memoryBlock.value}`
    )
    expect(runtime.isCoreClipped.value).toBe(false)
  })

  it('disables memory block when memoryMode is off', async () => {
    const profile = {
      id: 'doc',
      name: 'Doctor',
      memoryMode: 'off' as const,
      createdAt: 1,
      updatedAt: 1,
      projectPermissions: {},
    }
    const refreshProfile = vi.fn(async () => profile)
    const readSoul = vi.fn(async () => 'You are a doctor.')
    const readCoreMemory = vi.fn(async () => '# Core')
    const warn = vi.fn()

    const runtime = createChatProfileRuntime({
      profileId: 'doc',
      loadChatHistory: async () => {},
      refreshProfile,
      readSoul,
      readCoreMemory,
      warn,
    })

    await runtime.prepareProfile()
    expect(runtime.memoryBlock.value).toBeNull()
    expect(runtime.fullInstructions.value).toBe('You are a doctor.')
    expect(readCoreMemory).not.toHaveBeenCalled()
  })

  it('handles memory read failure gracefully', async () => {
    const profile = {
      id: 'doc',
      name: 'Doctor',
      memoryMode: 'auto' as const,
      createdAt: 1,
      updatedAt: 1,
      projectPermissions: {},
    }
    const refreshProfile = vi.fn(async () => profile)
    const readSoul = vi.fn(async () => 'You are a doctor.')
    const readCoreMemory = vi.fn().mockRejectedValue(new Error('Corrupt file'))
    const warn = vi.fn()

    const runtime = createChatProfileRuntime({
      profileId: 'doc',
      loadChatHistory: async () => {},
      refreshProfile,
      readSoul,
      readCoreMemory,
      warn,
    })

    await runtime.prepareProfile()
    expect(runtime.memoryBlock.value).toBeNull()
    expect(runtime.fullInstructions.value).toBe('You are a doctor.')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not read profile memory')
    )
  })
})
