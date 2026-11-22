import { chatToolName } from './tool-name'

import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { toolSettings } from '../../test/chat-tool-context'

import {
  CHAT_TOOL_COMMANDS,
  createDesktopChatTools,
  type DesktopChatToolsInvoke,
} from './desktop-chat-tools'

describe('desktop-chat-tools', () => {
  it('resolves file tools for an enabled profile and delegates IPC calls', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_ai_file_roots') {
        return [
          { path: 'workspace', read: 'allow', write: 'allow', delete: 'allow' },
        ]
      }
      return []
    }) as unknown as DesktopChatToolsInvoke

    const chatTools = createDesktopChatTools({
      getMaxStepCount: () => 4,
      profileId: 'writer',
      invoke,
      canUseTools: () => true,
      warn: vi.fn(),
      isDebugEnabled: () => false,
    })

    const result = await chatTools.turnTools('gpt-4', 5000, toolSettings())

    expect(result.canUseTools).toBe(true)
    expect(result.tools?.maxStepCount).toBe(4)
    expect(invoke).toHaveBeenCalledWith('list_ai_file_roots', {
      context: { kind: 'profile', profileId: 'writer' },
      attachments: [],
    })
  })

  it('includes debug tools when debug mode is enabled and omits tools when model lacks support', async () => {
    const invoke = vi.fn(async () => []) as unknown as DesktopChatToolsInvoke
    let supported = true

    const chatTools = createDesktopChatTools({
      getMaxStepCount: () => 4,
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
      getMaxStepCount: () => 4,
      profileId: 'writer',
      invoke,
      canUseTools: () => true,
      getMemoryMode: () => 'auto',
      getChatId: () => 'chat-456',
      warn: vi.fn(),
      isDebugEnabled: () => false,
    })

    expect(chatTools.mayOfferTools({ canUseTools: true })).toBe(true)

    const result = await chatTools.turnTools('gpt-4', 5000, undefined, 'auto')
    expect(result.canUseTools).toBe(true)
    const toolNames = Object.keys(result.tools!.tools!.tools)
    expect(toolNames).toContain('memory_read')
    expect(toolNames).toContain('memory_add')
  })

  it('resolves web tools by default in general chat and profiles, unless disabled', async () => {
    const invoke = vi.fn(async () => []) as unknown as DesktopChatToolsInvoke

    const generalChatTools = createDesktopChatTools({
      getMaxStepCount: () => 4,
      profileId: null,
      invoke,
      canUseTools: () => true,
      warn: vi.fn(),
      isDebugEnabled: () => false,
    })

    const generalResult = await generalChatTools.turnTools('gpt-4', 5000)
    const generalToolNames = Object.keys(generalResult.tools!.tools!.tools)
    expect(generalToolNames).toContain('web_search')
    expect(generalToolNames).toContain('web_fetch')

    const profileChatTools = createDesktopChatTools({
      getMaxStepCount: () => 4,
      profileId: 'researcher',
      invoke,
      canUseTools: () => true,
      warn: vi.fn(),
      isDebugEnabled: () => false,
    })

    const defaultProfileResult = await profileChatTools.turnTools('gpt-4', 5000)
    const defaultProfileToolNames = Object.keys(
      defaultProfileResult.tools!.tools!.tools
    )
    expect(defaultProfileToolNames).toContain('web_search')
    expect(defaultProfileToolNames).toContain('web_fetch')

    const disabledProfileResult = await profileChatTools.turnTools(
      'gpt-4',
      5000,
      toolSettings({ sources: { 'core:web': { isEnabled: false } } })
    )
    const disabledProfileToolNames = Object.keys(
      disabledProfileResult.tools!.tools!.tools
    )
    expect(disabledProfileToolNames).not.toContain('web_search')
    expect(disabledProfileToolNames).not.toContain('web_fetch')
  })

  it('gives the "Ask AI" chat the web access of the config', async () => {
    const invoke = vi.fn(async () => []) as unknown as DesktopChatToolsInvoke
    const web: { isEnabled?: boolean } = {}
    const chatTools = createDesktopChatTools({
      getMaxStepCount: () => 4,
      profileId: null,
      invoke,
      canUseTools: () => true,
      isAskAiWebEnabled: () => web.isEnabled,
      warn: vi.fn(),
      isDebugEnabled: () => false,
    })
    const approvalOf = (
      result: Awaited<ReturnType<typeof chatTools.turnTools>>
    ) =>
      (result.tools!.tools!.toolApproval as (call: unknown) => unknown)({
        toolCall: { toolName: 'web_search', input: { query: 'x' } },
      })

    // "Ask AI" never asks
    const byDefault = await chatTools.turnTools('gpt-4', 5000)
    expect(approvalOf(byDefault)).toBe('approved')

    web.isEnabled = false
    const off = await chatTools.turnTools('gpt-4', 5000)
    expect(Object.keys(off.tools!.tools!.tools)).not.toContain('web_search')
  })

  it('resolves user commands when commands group is enabled with selected command IDs', async () => {
    const invoke = vi.fn(async () => []) as unknown as DesktopChatToolsInvoke

    const chatTools = createDesktopChatTools({
      getMaxStepCount: () => 4,
      profileId: 'coder',
      invoke,
      canUseTools: () => true,
      warn: vi.fn(),
      isDebugEnabled: () => false,
      commands: () => [
        {
          id: 'custom-cmd',
          name: 'Run Script',
          description: 'A custom command for tests',
          phrases: [],
          isVoiceEnabled: false,
          operationId: 'script',
          operationConfig: { command: 'echo 1' },
          isLlmArgumentParsingEnabled: false,
          outputAction: 'none',
          isOutputLogged: false,
          isAvailableExternally: false,
          isEnabled: true,
        },
      ],
      operations: {
        get: (id) =>
          id === 'script'
            ? {
                id: 'script',
                owner: { kind: 'core' },
                description: 'Script runner',
                inputSchema: { type: 'object', properties: {} },
                run: vi.fn(async () => ({ ok: true, content: 'out' })),
              }
            : undefined,
      },
    })

    const result = await chatTools.turnTools(
      'gpt-4',
      5000,
      toolSettings({ commandIds: ['custom-cmd'] })
    )

    expect(result.canUseTools).toBe(true)
    const toolNames = Object.keys(result.tools!.tools!.tools)
    expect(toolNames).toContain(await chatToolName('custom-cmd'))
  })
})

describe('desktop-chat-tools commands', () => {
  it('calls only the tool commands, none of which changes a setting', () => {
    const source = readFileSync(
      new URL('./desktop-chat-tools.ts', import.meta.url),
      'utf8'
    )
    const called = [...source.matchAll(/invoke\(\s*'([a-z_]+)'/g)].map(
      (match) => match[1]
    )
    expect(called.length).toBeGreaterThan(0)
    for (const command of called) expect(CHAT_TOOL_COMMANDS).toContain(command)
    for (const command of CHAT_TOOL_COMMANDS)
      expect(command).not.toMatch(/config|save_ai_profile|update|project/)
  })
})
