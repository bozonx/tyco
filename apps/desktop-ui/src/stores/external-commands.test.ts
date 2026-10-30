import { disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_USER_CONFIG,
  type CommandConfig,
  type CommandRunEvent,
} from '@tyco/shared'

import { FakeDesktopError } from '../test/fake-desktop-backend'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../test/install-fake-desktop'
import { useExternalCommandsStore } from './external-commands'
import { useToolsStore } from './tools'

let desktop: TestDesktop

beforeEach(() => {
  desktop = installFakeDesktop()
  vi.clearAllMocks()
})

afterEach(() => {
  disposePinia(desktop.pinia)
  desktop.dispose()
})

describe('external commands store wiring', () => {
  it('wires runner, overlay and IPC properly on successful handleRun', async () => {
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

    desktop.backend.handle('claim_external_job', () => true)
    desktop.backend.handle('finish_external_job', () => null)
    desktop.backend.handle('log_command_run', () => undefined)
    desktop.backend.handle('show_status_overlay', () => undefined)

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
    expect(desktop.backend.callsOf('log_command_run')).toHaveLength(1)
    expect(desktop.backend.callsOf('show_status_overlay')).not.toEqual([])
  })

  it('handles cancellation properly', () => {
    const store = useExternalCommandsStore()
    expect(() => store.handleCancel('job-1')).not.toThrow()
  })
})

it('answers external access through the store and propagates failures', async () => {
  let isExpired = false
  desktop.backend.handle('answer_external_access', () => {
    if (isExpired)
      throw new FakeDesktopError({
        code: 'operationFailed',
        message: 'Request expired',
      })
  })
  const store = useExternalCommandsStore()
  await store.answerAccess('job-1', 'deny')
  expect(desktop.backend.callsOf('answer_external_access')).toEqual([
    { jobId: 'job-1', decision: 'deny' },
  ])
  isExpired = true
  await expect(store.answerAccess('job-1', 'once')).rejects.toThrow(
    'Request expired'
  )
})
