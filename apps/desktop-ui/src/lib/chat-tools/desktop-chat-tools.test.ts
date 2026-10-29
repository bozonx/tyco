import { chatToolName } from './tool-name'

import { describe, expect, it, vi } from 'vitest'

import {
  createDesktopChatTools,
  type DesktopChatToolsInvoke,
} from './desktop-chat-tools'

describe('desktop-chat-tools', () => {
  it('resolves file tools for an enabled profile and delegates IPC calls', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_ai_file_roots') {
        return [{ path: 'workspace', read: 'allow', write: 'allow' }]
      }
      return []
    }) as unknown as DesktopChatToolsInvoke

    const chatTools = createDesktopChatTools({
      profileId: 'writer',
      invoke,
      canUseTools: () => true,
      warn: vi.fn(),
      isDebugEnabled: () => false,
    })

    const result = await chatTools.turnTools('gpt-4', 5000, {
      groups: { files: { isEnabled: true, access: 'allow' } },
      maxStepCount: 4,
    })

    expect(result.canUseTools).toBe(true)
    expect(result.tools?.maxStepCount).toBe(4)
    expect(invoke).toHaveBeenCalledWith('list_ai_file_roots', {
      profileId: 'writer',
    })
  })

  it('includes debug tools when debug mode is enabled and omits tools when model lacks support', async () => {
    const invoke = vi.fn(async () => []) as unknown as DesktopChatToolsInvoke
    let supported = true

    const chatTools = createDesktopChatTools({
      profileId: null,
      invoke,
      canUseTools: () => supported,
      warn: vi.fn(),
      isDebugEnabled: () => true,
    })

    const active = await chatTools.turnTools('gpt-4', 5000)
    expect(active.canUseTools).toBe(true)
    expect(Object.keys(active.tools!.tools!.tools)).toContain(
      await chatToolName('get_current_time')
    )

    supported = false
    const disabled = await chatTools.turnTools('gpt-4', 5000)
    expect(disabled.canUseTools).toBe(false)
    expect(disabled.tools).toBeUndefined()
  })

  it('resolves memory tools and delegates memory operations to invoke', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'read_ai_profile_memory') return '# Core'
      if (command === 'list_ai_profile_memory_topics') return []
      return []
    }) as unknown as DesktopChatToolsInvoke

    const chatTools = createDesktopChatTools({
      profileId: 'writer',
      invoke,
      canUseTools: () => true,
      getMemoryMode: () => 'auto',
      getChatId: () => 'chat-456',
      warn: vi.fn(),
      isDebugEnabled: () => false,
    })

    expect(
      chatTools.mayOfferTools({ canUseTools: true, memoryMode: 'auto' })
    ).toBe(true)

    const result = await chatTools.turnTools('gpt-4', 5000, undefined, 'auto')
    expect(result.canUseTools).toBe(true)
    const toolNames = Object.keys(result.tools!.tools!.tools)
    expect(toolNames).toContain('memory_read')
    expect(toolNames).toContain('memory_add')
  })
})
