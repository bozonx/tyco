import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_USER_CONFIG,
  type CommandConfig,
  type CommandRunEvent,
} from '@tyco/shared'

import { useExternalCommandsStore } from './external-commands'
import { useIpcStore } from './ipc'
import { useToolsStore } from './tools'

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.clearAllMocks()
})

afterEach(() => {
  disposePinia(pinia)
})

describe('external commands store wiring', () => {
  it('wires runner, overlay and IPC properly on successful handleRun', async () => {
    const ipc = useIpcStore()
    const tools = useToolsStore()

    const runMock = vi
      .fn()
      .mockResolvedValue({ ok: true, content: 'output text' })
    tools.registerCoreTools([
      {
        id: 'mock.tool',
        name: 'Mock Tool',
        description: 'Test Tool',
        run: runMock,
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
        },
      } as any,
    ])

    const cmd: CommandConfig = {
      id: 'cmd-ext',
      name: 'External Command',
      enabled: true,
      toolId: 'mock.tool',
      toolConfig: {},
      phrases: [],
      isLlmArgumentParsingEnabled: false,
      launcherAfterRun: { action: 'none' },
      logOutput: false,
      availableIn: { external: true, chat: false },
    }

    const callFunctionSpy = vi
      .spyOn(ipc, 'callFunction')
      .mockResolvedValue({ success: true, result: undefined as any })

    const store = useExternalCommandsStore()

    const event: CommandRunEvent = {
      commandId: 'cmd-ext',
      text: 'input text',
      userConfig: { ...DEFAULT_USER_CONFIG, commands: [cmd] },
    }

    await store.handleRun(event)

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { text: 'input text' },
        source: 'external',
      })
    )
    expect(callFunctionSpy).toHaveBeenCalledWith(
      'logCommandRun',
      expect.anything()
    )
  })

  it('handles cancellation properly', () => {
    const store = useExternalCommandsStore()
    expect(() => store.handleCancel('job-1')).not.toThrow()
  })
})
