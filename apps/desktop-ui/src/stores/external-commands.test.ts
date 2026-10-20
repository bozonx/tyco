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
      isEnabled: true,
      toolId: 'mock.tool',
      toolConfig: {},
      phrases: [],
      isLlmArgumentParsingEnabled: false,
      isVoiceEnabled: false,
      outputAction: 'none',
      isOutputLogged: false,
      isAvailableExternally: true,
    }

    const callSpy = vi
      .spyOn(ipc, 'call')
      .mockImplementation(async (command) => ({
        success: true,
        result: (command === 'claim_external_job') as any,
      }))

    const store = useExternalCommandsStore()

    const event: CommandRunEvent = {
      commandId: 'cmd-ext',
      jobId: 'job-ext',
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
    expect(callSpy).toHaveBeenCalledWith('log_command_run', expect.anything())
  })

  it('handles cancellation properly', () => {
    const store = useExternalCommandsStore()
    expect(() => store.handleCancel('job-1')).not.toThrow()
  })
})

it('answers external access through the store and propagates failures', async () => {
  const call = vi
    .spyOn(useIpcStore(), 'call')
    .mockResolvedValue({ success: true, result: undefined })
  const store = useExternalCommandsStore()
  await store.answerAccess('job-1', 'deny')
  expect(call).toHaveBeenCalledWith('answer_external_access', {
    jobId: 'job-1',
    decision: 'deny',
  })
  call.mockResolvedValueOnce({ success: false, error: 'Request expired' })
  await expect(store.answerAccess('job-1', 'once')).rejects.toThrow(
    'Request expired'
  )
})
