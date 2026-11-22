import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandConfig } from '@tyco/shared'

import type * as CommandRunnerModule from '../lib/commands/command-runner'
import { createCommand } from '../lib/commands/command-config'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import { useHistoryStore } from './history'
import { useVoiceCommandsStore } from './voice-commands'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  dictationText: 'test voice hello voice',
}))

vi.mock('../lib/commands/command-runner', async (importOriginal) => ({
  ...(await importOriginal<typeof CommandRunnerModule>()),
  createCommandRunner: () => ({ run: mocks.runCommand }),
}))

vi.mock('../composables/use-dictation-actions', () => ({
  useDictationActions: () => ({
    startDictation: vi.fn(async () => {}),
    finishDictation: vi.fn(async () => mocks.dictationText),
    cancelDictation: vi.fn(async () => {}),
  }),
}))

describe('useVoiceCommandsStore', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    vi.clearAllMocks()
    desktop = await loadFakeDesktop()
    mocks.dictationText = 'test voice hello voice'

    const validVoiceCommand: CommandConfig = {
      ...createCommand('core.correct', 'cmd-1'),
      name: 'Test Voice Command',
      isEnabled: true,
      isVoiceEnabled: true,
      phrases: ['test voice'],
    }

    desktop.setUserConfig({ commands: [validVoiceCommand] })
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('runs a voice command through finish and run, updating history and logging', async () => {
    mocks.runCommand.mockImplementationOnce(
      (
        _command: CommandConfig,
        _text: string,
        options: { onOutput?: (output: string) => void }
      ) => {
        options.onOutput?.('Hello voice.')
        return Promise.resolve({ success: true, message: 'Done' })
      }
    )
    const store = useVoiceCommandsStore()
    const history = useHistoryStore()

    await store.start()
    await store.finish('review')

    expect(store.selected?.commandId).toBe('cmd-1')
    expect(store.canRun).toBe(true)

    await history.loadEditorHistory()
    expect(history.editorHistory).toEqual([
      expect.objectContaining({
        text: 'test voice hello voice',
        kind: 'draft',
        origin: 'voice',
        instruction: { text: '', inputKind: 'voice' },
      }),
    ])
    const draftId = history.editorHistory[0]?.id

    await store.run()

    expect(mocks.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cmd-1' }),
      'hello voice',
      expect.objectContaining({ source: 'voice' })
    )
    expect(desktop.backend.callsOf('add_editor_history_item')).toContainEqual({
      entry: {
        id: draftId,
        text: 'hello voice',
        kind: 'source',
        operation: 'correction',
        origin: 'voice',
        instruction: { text: 'Test Voice Command', inputKind: 'voice' },
      },
    })
    expect(
      desktop.backend.callsOf('set_editor_history_item_result')
    ).toContainEqual({ id: draftId, result: 'Hello voice.' })
    expect(desktop.backend.callsOf('log_command_run')).toEqual([
      {
        record: {
          commandId: 'cmd-1',
          name: 'Test Voice Command',
          source: 'voice',
          text: 'hello voice',
          success: true,
          message: 'Done',
        },
      },
    ])
  })

  it('marks a voice command without output as completed and records failures', async () => {
    const scriptCommand: CommandConfig = {
      ...createCommand('script', 'cmd-script'),
      name: 'Run Script',
      isEnabled: true,
      isVoiceEnabled: true,
      phrases: ['test voice'],
      operationConfig: { command: 'echo {{TEXT}}' },
      outputAction: 'none',
    }
    desktop.setUserConfig({ commands: [scriptCommand] })
    mocks.runCommand
      .mockResolvedValueOnce({ success: false, message: 'Exit code 1' })
      .mockResolvedValueOnce({ success: true })

    const store = useVoiceCommandsStore()
    await store.start()
    await store.finish('review')
    await store.run()

    expect(desktop.backend.callsOf('set_editor_history_item_failure')).toEqual([
      {
        id: expect.any(String),
        failure: { kind: 'error', message: 'Exit code 1' },
      },
    ])

    await store.run()
    expect(desktop.backend.callsOf('add_editor_history_item')).toContainEqual({
      entry: { text: 'hello voice', kind: 'output', origin: 'voice' },
    })
  })

  it('stops a voice command at the shared run limit and records timeout failure in history', async () => {
    desktop.setUserConfig({
      commands: desktop.backend.userConfig.commands,
      commandRunTimeoutSec: 2,
    })
    let runSignal: AbortSignal | undefined
    mocks.runCommand.mockImplementationOnce(
      (
        _command: CommandConfig,
        _text: string,
        options: { signal: AbortSignal }
      ) => {
        runSignal = options.signal
        return new Promise(() => {})
      }
    )
    const store = useVoiceCommandsStore()
    await store.start()
    await store.finish('review')

    vi.useFakeTimers()
    try {
      const run = store.run()
      await vi.advanceTimersByTimeAsync(2000)
      await run
    } finally {
      vi.useRealTimers()
    }

    expect(runSignal?.aborted).toBe(true)
    expect(store.stage).toBe('review')
    expect(store.error).toBe('Did not finish in 2 s and was stopped')
    expect(desktop.backend.callsOf('set_editor_history_item_failure')).toEqual([
      { id: expect.any(String), failure: { kind: 'timeout' } },
    ])
    expect(desktop.backend.callsOf('log_command_run')).toEqual([
      {
        record: expect.objectContaining({ commandId: 'cmd-1', success: false }),
      },
    ])
  })

  it('handles cancellation and abort without running command', async () => {
    const store = useVoiceCommandsStore()
    await store.start()
    await store.cancel()

    expect(store.stage).toBe('idle')
    expect(mocks.runCommand).not.toHaveBeenCalled()
  })

  it('includes builtin translation command in catalog when isVoiceCommandEnabled is true and excludes when false', async () => {
    desktop.setUserConfig({
      translation: {
        ...desktop.backend.userConfig.translation,
        isVoiceCommandEnabled: true,
      },
    })
    let store = useVoiceCommandsStore()
    expect(store.catalog.some((c) => c.id === 'translate')).toBe(true)

    desktop.setUserConfig({
      translation: {
        ...desktop.backend.userConfig.translation,
        isVoiceCommandEnabled: false,
      },
    })
    store = useVoiceCommandsStore()
    expect(store.catalog.some((c) => c.id === 'translate')).toBe(false)
  })
})
