import { toolContext } from '../../test/chat-tool-context'
import { describe, expect, it, vi } from 'vitest'
import type { CommandConfig, ProfileToolSettings } from '@tyco/shared'

import type {
  RegisteredOperation,
  OperationLookup,
} from '../operations/operation-types'
import { createCommandToolProvider } from './command-tools'
import { chatToolName } from './tool-name'

const signal = new AbortController().signal

const mockCommand = (patch: Partial<CommandConfig> = {}): CommandConfig => ({
  id: 'cmd-1',
  name: 'Test Command',
  description: 'A helpful tool for the model',
  phrases: [],
  isVoiceEnabled: false,
  operationId: 'script',
  operationConfig: { command: 'echo hello' },
  isLlmArgumentParsingEnabled: false,
  outputAction: 'none',
  isOutputLogged: false,
  isAvailableExternally: false,
  isEnabled: true,
  ...patch,
})

const mockTool = (
  patch: Partial<RegisteredOperation> = {}
): RegisteredOperation => ({
  id: 'script',
  owner: { kind: 'core' },
  description: 'Script runner',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  run: vi.fn(async () => ({ ok: true, content: 'command output' })),
  ...patch,
})

const createLookup = (
  tools: Record<string, RegisteredOperation> = { script: mockTool() }
): OperationLookup => ({ get: (id) => tools[id] })

const profileSettings = (
  patch: { commandIds?: string[]; isOff?: boolean } = {}
): ProfileToolSettings => ({
  sources: patch.isOff ? { 'commands:commands': { isEnabled: false } } : {},
  tools: {},
  pickedCommandIds: patch.commandIds ?? ['cmd-1'],
})

describe('command-tools', () => {
  it('offers every command when the profile picked none', async () => {
    const provider = createCommandToolProvider({
      commands: () => [mockCommand()],
      operations: createLookup(),
    })

    expect(
      await provider.tools({ ...toolContext('p1'), modelId: 'm1' })
    ).toHaveLength(1)
  })

  it('offers nothing with the commands off or none picked', async () => {
    const provider = createCommandToolProvider({
      commands: () => [mockCommand()],
      operations: createLookup(),
    })

    expect(
      await provider.tools({
        ...toolContext('p1', profileSettings({ commandIds: [] })),
        modelId: 'm1',
      })
    ).toEqual([])

    expect(
      await provider.tools({
        ...toolContext('p1', profileSettings({ isOff: true })),
        modelId: 'm1',
      })
    ).toEqual([])
  })

  it('offers only explicitly selected commands', async () => {
    const cmd1 = mockCommand({ id: 'cmd-1', name: 'Command 1' })
    const cmd2 = mockCommand({ id: 'cmd-2', name: 'Command 2' })
    const provider = createCommandToolProvider({
      commands: () => [cmd1, cmd2],
      operations: createLookup(),
    })

    const tools = await provider.tools({
      ...toolContext('p1', profileSettings({ commandIds: ['cmd-1'] })),
      modelId: 'm1',
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
      operations: createLookup(),
    })

    const tools = await provider.tools({
      ...toolContext('p1', profileSettings({ commandIds: ['cmd-1', 'cmd-2'] })),
      modelId: 'm1',
    })

    expect(tools).toEqual([])
  })

  it('skips disabled commands', async () => {
    const disabledCmd = mockCommand({ id: 'cmd-1', isEnabled: false })
    const provider = createCommandToolProvider({
      commands: () => [disabledCmd],
      operations: createLookup(),
    })

    const tools = await provider.tools({
      ...toolContext('p1', profileSettings({ commandIds: ['cmd-1'] })),
      modelId: 'm1',
    })

    expect(tools).toEqual([])
  })

  it('skips tools marked canRunFromChat: false', async () => {
    const restrictedTool = mockTool({ canRunFromChat: false })
    const provider = createCommandToolProvider({
      commands: () => [mockCommand({ operationId: 'restricted' })],
      operations: createLookup({ restricted: restrictedTool }),
    })

    const tools = await provider.tools({
      ...toolContext('p1', profileSettings({ commandIds: ['cmd-1'] })),
      modelId: 'm1',
    })

    expect(tools).toEqual([])
  })

  it('skips commands for other platforms', async () => {
    const linuxCmd = mockCommand({ platforms: ['linux'] })
    const provider = createCommandToolProvider({
      commands: () => [linuxCmd],
      operations: createLookup(),
      environment: () => ({ platform: 'windows', variables: {} }),
    })

    const tools = await provider.tools({
      ...toolContext('p1', profileSettings({ commandIds: ['cmd-1'] })),
      modelId: 'm1',
    })

    expect(tools).toEqual([])
  })

  it('skips commands whose tool is missing or unavailable', async () => {
    const unavailableTool = mockTool({
      getUnavailableReasonKey: () => 'operations.noApiKey',
    })
    const warn = vi.fn()
    const provider = createCommandToolProvider({
      commands: () => [
        mockCommand({ id: 'cmd-1', operationId: 'missing' }),
        mockCommand({ id: 'cmd-2', operationId: 'unavailable' }),
      ],
      operations: createLookup({ unavailable: unavailableTool }),
      warn,
    })

    const tools = await provider.tools({
      ...toolContext('p1', profileSettings({ commandIds: ['cmd-1', 'cmd-2'] })),
      modelId: 'm1',
    })

    expect(tools).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Tool "missing" for command "Test Command" not found'
      )
    )
  })

  it('stops a command at the shared run limit', async () => {
    vi.useFakeTimers()
    try {
      let toolSignal: AbortSignal | undefined
      const run = vi.fn(async (call: { signal: AbortSignal }) => {
        toolSignal = call.signal
        return new Promise<{ ok: boolean }>(() => {})
      })
      const provider = createCommandToolProvider({
        commands: () => [mockCommand()],
        operations: createLookup({ script: mockTool({ run }) }),
        runLimitSec: () => 5,
      })
      const [chatTool] = await provider.tools({
        ...toolContext('p1', profileSettings()),
        modelId: 'm1',
      })
      const result = chatTool!.execute(
        { text: 'hello' },
        { signal, toolCallId: 'call-1', outputLimitCharacters: 20_000 }
      )
      const rejection = expect(result).rejects.toThrow(
        'The command did not finish within 5 s and was stopped'
      )
      await vi.advanceTimersByTimeAsync(5000)
      await rejection
      expect(toolSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('executes an adapted command successfully', async () => {
    const run = vi.fn(async () => ({ ok: true, content: 'Done executing' }))
    const tool = mockTool({ run })
    const command = mockCommand({
      id: 'cmd-exec',
      name: 'Exec Command',
      description: 'Executes things',
      operationConfig: { command: 'echo hi' },
    })
    const provider = createCommandToolProvider({
      commands: () => [command],
      operations: createLookup({ script: tool }),
    })

    const [chatTool] = await provider.tools({
      ...toolContext('p1', profileSettings({ commandIds: ['cmd-exec'] })),
      modelId: 'm1',
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
