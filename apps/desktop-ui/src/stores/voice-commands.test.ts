import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandConfig } from '@tyco/shared'

import { createCommand } from '../lib/commands/command-config'
import { useDesktopStore } from './desktop'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useVoiceCommandsStore } from './voice-commands'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  saveOutput: vi.fn(),
  call: vi.fn(),
  dictationText: 'test voice hello voice',
}))

vi.mock('../lib/commands/command-runner', () => ({
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
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()

    mocks.dictationText = 'test voice hello voice'

    const history = useHistoryStore()
    mocks.saveOutput.mockResolvedValue('out-1')
    vi.spyOn(history, 'saveOutput').mockImplementation(mocks.saveOutput)

    const ipc = useIpcStore()
    mocks.call.mockResolvedValue({ success: true })
    vi.spyOn(ipc, 'call').mockImplementation(mocks.call)

    const validVoiceCommand: CommandConfig = {
      ...createCommand('core.correct', 'cmd-1'),
      name: 'Test Voice Command',
      isEnabled: true,
      isVoiceEnabled: true,
      phrases: ['test voice'],
    }

    const desktop = useDesktopStore()
    desktop.applyViewState({
      ...desktop.desktopState,
      userConfig: {
        ...desktop.desktopState.userConfig,
        commands: [validVoiceCommand],
      },
    })
  })

  afterEach(() => {
    disposePinia(pinia)
  })

  it('runs a voice command through finish and run, saving output and logging', async () => {
    mocks.runCommand.mockResolvedValueOnce({ success: true, message: 'Done' })
    const store = useVoiceCommandsStore()

    await store.start()
    await store.finish('review')

    expect(store.selected?.commandId).toBe('cmd-1')
    expect(store.canRun).toBe(true)

    await store.run()

    expect(mocks.saveOutput).toHaveBeenCalledWith('hello voice')
    expect(mocks.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cmd-1' }),
      'hello voice',
      expect.objectContaining({ source: 'voice' })
    )
    expect(mocks.call).toHaveBeenCalledWith('log_command_run', {
      record: {
        commandId: 'cmd-1',
        name: 'Test Voice Command',
        source: 'voice',
        text: 'hello voice',
        success: true,
        message: 'Done',
      },
    })
  })

  it('handles cancellation and abort without running command', async () => {
    const store = useVoiceCommandsStore()
    await store.start()
    await store.cancel()

    expect(store.stage).toBe('idle')
    expect(mocks.runCommand).not.toHaveBeenCalled()
  })
})
