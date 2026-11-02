import { describe, expect, it, vi } from 'vitest'
import {
  COMMANDS_TOOL_GROUP_ID,
  type CommandConfig,
  type ProfileToolSettings,
} from '@tyco/shared'

import type { RegisteredTool, ToolLookup } from '../tools/tool-types'
import { createCommandToolProvider } from './command-tools'
import { chatToolName } from './tool-name'

const signal = new AbortController().signal

const mockCommand = (patch: Partial<CommandConfig> = {}): CommandConfig => ({
  id: 'cmd-1',
  name: 'Test Command',
  description: 'A helpful tool for the model',
  phrases: [],
  isVoiceEnabled: false,
  toolId: 'script',
  toolConfig: { command: 'echo hello' },
  isLlmArgumentParsingEnabled: false,
  outputAction: 'none',
  isOutputLogged: false,
  isAvailableExternally: false,
  externalTimeoutSec: 120,
  isEnabled: true,
  ...patch,
})

const mockTool = (patch: Partial<RegisteredTool> = {}): RegisteredTool => ({
  id: 'script',
  owner: { kind: 'core' },
  description: 'Script runner',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  run: vi.fn(async () => ({ ok: true, content: 'command output' })),
  ...patch,
})

const createLookup = (
  tools: Record<string, RegisteredTool> = { script: mockTool() }
): ToolLookup => ({ get: (id) => tools[id] })

const profileSettings = (
  patch: Partial<ProfileToolSettings['groups'][string]> = {}
): ProfileToolSettings => ({
  groups: {
    [COMMANDS_TOOL_GROUP_ID]: {
      isEnabled: true,
      access: 'ask',
      commandIds: ['cmd-1'],
      ...patch,
    },
  },
})

describe('command-tools', () => {
  it('returns no tools when the group is disabled or denied', async () => {
    const provider = createCommandToolProvider({
      commands: () => [mockCommand()],
      tools: createLookup(),
    })

    expect(
      await provider.tools({
        profileId: 'p1',
        modelId: 'm1',
        settings: undefined,
      })
    ).toEqual([])

    expect(
      await provider.tools({
        profileId: 'p1',
        modelId: 'm1',
        settings: profileSettings({ isEnabled: false }),
      })
    ).toEqual([])

    expect(
      await provider.tools({
        profileId: 'p1',
        modelId: 'm1',
        settings: profileSettings({ access: 'deny' }),
      })
    ).toEqual([])
  })

  it('returns no tools when no commandIds are selected', async () => {
    const provider = createCommandToolProvider({
      commands: () => [mockCommand()],
      tools: createLookup(),
    })

    expect(
      await provider.tools({
        profileId: 'p1',
        modelId: 'm1',
        settings: profileSettings({ commandIds: [] }),
      })
    ).toEqual([])

    expect(
      await provider.tools({
        profileId: 'p1',
        modelId: 'm1',
        settings: profileSettings({ commandIds: undefined }),
      })
    ).toEqual([])
  })

  it('offers only explicitly selected commands', async () => {
    const cmd1 = mockCommand({ id: 'cmd-1', name: 'Command 1' })
    const cmd2 = mockCommand({ id: 'cmd-2', name: 'Command 2' })
    const provider = createCommandToolProvider({
      commands: () => [cmd1, cmd2],
      tools: createLookup(),
    })

    const tools = await provider.tools({
      profileId: 'p1',
      modelId: 'm1',
      settings: profileSettings({ commandIds: ['cmd-1'] }),
    })

    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe(await chatToolName('cmd-1'))
    expect(tools[0]!.label).toBe('Command 1')
  })

  it('skips commands without a description or with blank description', async () => {
    const cmdBlank = mockCommand({ id: 'cmd-1', description: '   ' })
    const cmdEmpty = mockCommand({ id: 'cmd-2', description: '' })
    const provider = createCommandToolProvider({
      commands: () => [cmdBlank, cmdEmpty],
      tools: createLookup(),
    })

    const tools = await provider.tools({
      profileId: 'p1',
      modelId: 'm1',
      settings: profileSettings({ commandIds: ['cmd-1', 'cmd-2'] }),
    })

    expect(tools).toEqual([])
  })

  it('skips disabled commands', async () => {
    const disabledCmd = mockCommand({ id: 'cmd-1', isEnabled: false })
    const provider = createCommandToolProvider({
      commands: () => [disabledCmd],
      tools: createLookup(),
    })

    const tools = await provider.tools({
      profileId: 'p1',
      modelId: 'm1',
      settings: profileSettings({ commandIds: ['cmd-1'] }),
    })

    expect(tools).toEqual([])
  })

  it('skips tools marked canRunFromChat: false', async () => {
    const restrictedTool = mockTool({ canRunFromChat: false })
    const provider = createCommandToolProvider({
      commands: () => [mockCommand({ toolId: 'restricted' })],
      tools: createLookup({ restricted: restrictedTool }),
    })

    const tools = await provider.tools({
      profileId: 'p1',
      modelId: 'm1',
      settings: profileSettings({ commandIds: ['cmd-1'] }),
    })

    expect(tools).toEqual([])
  })

  it('skips commands for other platforms', async () => {
    const linuxCmd = mockCommand({ platforms: ['linux'] })
    const provider = createCommandToolProvider({
      commands: () => [linuxCmd],
      tools: createLookup(),
      environment: () => ({ platform: 'windows', variables: {} }),
    })

    const tools = await provider.tools({
      profileId: 'p1',
      modelId: 'm1',
      settings: profileSettings({ commandIds: ['cmd-1'] }),
    })

    expect(tools).toEqual([])
  })

  it('skips commands whose tool is missing or unavailable', async () => {
    const unavailableTool = mockTool({
      getUnavailableReasonKey: () => 'tools.noApiKey',
    })
    const warn = vi.fn()
    const provider = createCommandToolProvider({
      commands: () => [
        mockCommand({ id: 'cmd-1', toolId: 'missing' }),
        mockCommand({ id: 'cmd-2', toolId: 'unavailable' }),
      ],
      tools: createLookup({ unavailable: unavailableTool }),
      warn,
    })

    const tools = await provider.tools({
      profileId: 'p1',
      modelId: 'm1',
      settings: profileSettings({ commandIds: ['cmd-1', 'cmd-2'] }),
    })

    expect(tools).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Tool "missing" for command "Test Command" not found'
      )
    )
  })

  it('executes an adapted command successfully', async () => {
    const run = vi.fn(async () => ({ ok: true, content: 'Done executing' }))
    const tool = mockTool({ run })
    const command = mockCommand({
      id: 'cmd-exec',
      name: 'Exec Command',
      description: 'Executes things',
      toolConfig: { command: 'echo hi' },
    })
    const provider = createCommandToolProvider({
      commands: () => [command],
      tools: createLookup({ script: tool }),
    })

    const [chatTool] = await provider.tools({
      profileId: 'p1',
      modelId: 'm1',
      settings: profileSettings({ commandIds: ['cmd-exec'] }),
    })

    expect(chatTool).toBeDefined()
    expect(chatTool!.name).toBe(await chatToolName('cmd-exec'))
    expect(chatTool!.label).toBe('Exec Command')
    expect(chatTool!.description).toBe('Executes things')

    const result = await chatTool!.execute(
      { text: 'hello' },
      { signal, toolCallId: 'call-1', outputLimitCharacters: 20_000 }
    )

    expect(result).toBe('Done executing')
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { text: 'hello' },
        source: 'chat',
        command: {
          id: 'cmd-exec',
          name: 'Exec Command',
          isOutputLogged: false,
        },
      })
    )
  })
})
