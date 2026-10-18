import { DESKTOP_COMMANDS } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  createDesktopChatTools,
  type DesktopChatToolsInvoke,
} from './desktop-chat-tools'

describe('desktop-chat-tools', () => {
  it('resolves file tools for an enabled profile and delegates IPC calls', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === DESKTOP_COMMANDS.LIST_AI_FILE_ROOTS) {
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
    expect(invoke).toHaveBeenCalledWith(DESKTOP_COMMANDS.LIST_AI_FILE_ROOTS, {
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
      'get_current_time'
    )

    supported = false
    const disabled = await chatTools.turnTools('gpt-4', 5000)
    expect(disabled.canUseTools).toBe(false)
    expect(disabled.tools).toBeUndefined()
  })
})
