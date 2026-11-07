import { describe, expect, it, vi } from 'vitest'
import { createCommand } from '../commands/command-config'
import { testTools } from '../tools/testing'
import { createBuiltInVoiceCommands } from './built-in-voice-commands'
import { translate } from '../i18n'
import { DictationError } from '../stt/dictation-error'
import {
  createVoiceCommandModel,
  type VoiceCommandDependencies,
} from './voice-command-model'

function setup(overrides: Partial<VoiceCommandDependencies> = {}) {
  const baseTools = testTools()
  const scriptTool = baseTools.get('script')!
  const tools = {
    get: (id: string) =>
      baseTools.get(id) ?? {
        ...scriptTool,
        id,
        inputSchemaFor: undefined,
        inputSchema: {
          type: 'object' as const,
          properties: { text: { type: 'string' as const } },
          required: ['text'],
        },
      },
  }
  const builtInCommands = createBuiltInVoiceCommands(tools, translate)
  const commands = [
    {
      ...createCommand('script', 'note'),
      isVoiceEnabled: true,
      phrases: ['save note'],
      toolConfig: { command: 'echo {{TEXT}}' },
    },
  ]
  let handlers:
    Parameters<VoiceCommandDependencies['startDictation']>[0] | undefined
  const deps: VoiceCommandDependencies = {
    commands: () => commands,
    builtInCommands: () => builtInCommands,
    tools,
    startDictation: vi.fn(async (next) => {
      handlers = next
    }),
    finishDictation: vi.fn(async () => 'save note Hello!'),
    cancelDictation: vi.fn(async () => {}),
    run: vi.fn(async () => ({ success: true })),
    saveTranscript: vi.fn(async () => 'source-id'),
    ...overrides,
  }
  const model = createVoiceCommandModel(deps)
  return {
    commands,
    deps,
    model,
    partial: (text: string) => handlers?.onText({ committed: '', draft: text }),
  }
}

describe('voice command session', () => {
  it('stops a forgotten recording at the limit and waits for review', async () => {
    vi.useFakeTimers()
    try {
      const { model, deps } = setup({ silenceTimeoutMs: 7_200_000 })
      await model.start()
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(deps.finishDictation).toHaveBeenCalledOnce()
      expect(model.stage.value).toBe('review')
      expect(model.error.value).toBe('toast.recordingLimitReached')
      expect(deps.run).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops after three minutes without recognized speech and waits for review', async () => {
    vi.useFakeTimers()
    try {
      const { model, deps, partial } = setup()
      await model.start()
      await vi.advanceTimersByTimeAsync(170_000)
      partial('save note')
      await vi.advanceTimersByTimeAsync(150_000)
      expect(deps.finishDictation).not.toHaveBeenCalled()
      expect(model.autoStopWarning.value).toBeUndefined()
      await vi.advanceTimersByTimeAsync(15_000)
      expect(model.autoStopWarning.value).toMatchObject({ reason: 'silence' })
      await vi.advanceTimersByTimeAsync(15_000)
      expect(deps.finishDictation).toHaveBeenCalledOnce()
      expect(model.stage.value).toBe('review')
      expect(model.error.value).toBe('toast.recordingSilenceStop')
      expect(deps.run).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the recognized speech in the history before the review', async () => {
    const { model, deps } = setup()
    await model.start()
    await model.finish('review')
    expect(deps.saveTranscript).toHaveBeenCalledWith('save note Hello!')
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('tells a dictation failure by its message key', async () => {
    const { model } = setup({
      finishDictation: vi.fn(async () => {
        throw new DictationError('timeout', 'Timed out')
      }),
    })
    await model.start()
    await model.finish()
    expect(model.error.value).toBe('toast.dictationTimeout')
  })

  it('clears the limit when the recording is finished or cancelled', async () => {
    vi.useFakeTimers()
    try {
      const { model } = setup()
      await model.start()
      await model.finish('review')
      await model.cancel()
      expect(vi.getTimerCount()).toBe(0)
      expect(model.error.value).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts the silence timer only once the microphone is recording', async () => {
    vi.useFakeTimers()
    try {
      let releaseStart!: () => void
      const { model, deps } = setup({
        startDictation: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseStart = resolve
            })
        ),
      })
      const starting = model.start()
      await Promise.resolve()
      expect(vi.getTimerCount()).toBe(0)
      releaseStart()
      await starting
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      await vi.advanceTimersByTimeAsync(180_000)
      expect(deps.finishDictation).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('previews revised partials, waits for final STT and requires confirmation when finished for review', async () => {
    const { model, deps, partial } = setup()
    await model.start()
    partial('save note Early')
    expect(model.resolution.value.kind).toBe('match')
    expect(model.liveTranscript.value).toEqual({
      committed: '',
      draft: 'save note Early',
    })
    partial('unrelated')
    expect(model.resolution.value.kind).toBe('none')
    expect(deps.run).not.toHaveBeenCalled()
    await model.finish('review')
    expect(model.inputText.value).toBe('Hello!')
    expect(deps.run).not.toHaveBeenCalled()
    await model.run()
    expect(deps.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'note' }),
      'Hello!',
      expect.any(AbortSignal)
    )
  })
  it('runs only exact final valid input when finished to run', async () => {
    const { model, deps, partial } = setup()
    await model.start()
    partial('save note Early')
    expect(deps.run).not.toHaveBeenCalled()
    await model.finish()
    expect(deps.run).toHaveBeenCalledOnce()
  })
  it('shows speech dropped before a repeated command and waits for confirmation', async () => {
    const { model, deps } = setup()
    deps.finishDictation = vi.fn(async () => 'save mote Hi. Save note Hello!')
    await model.start()
    await model.finish()
    expect(model.selected.value?.commandId).toBe('note')
    expect(model.inputText.value).toBe('Hello!')
    expect(model.discardedText.value).toBe('save mote Hi.')
    expect(deps.run).not.toHaveBeenCalled()
    model.chooseCommand('note')
    expect(model.discardedText.value).toBe('')
  })
  it('does not run after cancellation or when an old final response arrives', async () => {
    const { model, deps } = setup()
    let resolve!: (text: string) => void
    deps.finishDictation = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done
        })
    )
    await model.start()
    const finishing = model.finish()
    await Promise.resolve()
    await model.cancel()
    resolve('save note Late')
    await finishing
    expect(deps.run).not.toHaveBeenCalled()
    expect(model.stage.value).toBe('idle')
  })
  it('requires choosing an ambiguous candidate and preserves the entire manual input', async () => {
    const { model, deps, commands } = setup()
    commands.push({ ...commands[0]!, id: 'second' })
    await model.start()
    await model.finish()
    expect(model.resolution.value.kind).toBe('ambiguous')
    expect(deps.run).not.toHaveBeenCalled()
    model.chooseCommand('second')
    expect(model.inputText.value).toBe('save note Hello!')
  })
  it('runs a voice command with no text or selection input', async () => {
    const { model, deps, commands } = setup({
      finishDictation: vi.fn(async () => 'turn off kitchen lights'),
    })
    commands[0]!.phrases = ['turn off kitchen lights']
    commands[0]!.toolConfig = { command: 'home-control kitchen off' }
    await model.start()
    await model.finish('review')
    expect(model.inputText.value).toBe('')
    expect(model.canRun.value).toBe(true)
    await model.run()
    expect(deps.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'note' }),
      '',
      expect.any(AbortSignal)
    )
  })

  it('rejects missing or extra input without substituting a selection', async () => {
    const { model, deps, commands } = setup()
    deps.finishDictation = vi.fn(async () => 'save note')
    await model.start()
    await model.finish()
    expect(model.inputIssue.value).toBe('missing-text')
    expect(deps.run).not.toHaveBeenCalled()
    commands[0]!.toolConfig = { command: 'backup' }
    model.inputText.value = 'actually cancel'
    expect(model.inputIssue.value).toBe('extra-text')
    await model.run()
    expect(deps.run).not.toHaveBeenCalled()
  })
  it('rechecks permissions on submission and retains input on failure', async () => {
    const { model, deps, commands } = setup()
    await model.start()
    await model.finish('review')
    commands[0]!.isVoiceEnabled = false
    await model.run()
    expect(deps.run).not.toHaveBeenCalled()
    commands[0]!.isVoiceEnabled = true
    deps.run = vi.fn(async () => ({ success: false, message: 'Unavailable' }))
    await model.run()
    expect(model.inputText.value).toBe('Hello!')
    expect(model.error.value).toBe('Unavailable')
    expect(model.stage.value).toBe('review')
    expect(deps.run).toHaveBeenCalledOnce()
  })
})

it('clears the previous execution error when retrying successfully', async () => {
  const { model, deps } = setup()
  deps.run = vi
    .fn()
    .mockResolvedValueOnce({ success: false, message: 'Failed' })
    .mockResolvedValueOnce({ success: true })
  await model.start()
  await model.finish('review')
  await model.run()
  expect(model.error.value).toBe('Failed')
  await model.run()
  expect(model.error.value).toBe('')
})

it('preserves text on STT start and finish failures and allows a fresh recording', async () => {
  const { model, deps, partial } = setup()
  await model.start()
  partial('save note Keep this')
  deps.finishDictation = vi
    .fn()
    .mockRejectedValueOnce(new Error('STT finish failed'))
    .mockResolvedValueOnce('save note Recovered')
  await model.finish()
  expect(model.error.value).toBe('STT finish failed')
  expect(model.transcript.value).toBe('save note Keep this')
  deps.startDictation = vi
    .fn()
    .mockRejectedValueOnce(new Error('Microphone unavailable'))
    .mockResolvedValueOnce(undefined)
  await model.start()
  expect(model.stage.value).toBe('review')
  expect(model.transcript.value).toBe('save note Keep this')
  await model.start()
  await model.finish('review')
  expect(model.inputText.value).toBe('Recovered')
  expect(deps.run).not.toHaveBeenCalled()
})

it('serializes a new activation behind cancellation of a pending microphone start', async () => {
  const { model, deps } = setup()
  let release!: () => void
  deps.startDictation = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    .mockResolvedValueOnce(undefined)
  const first = model.start()
  await Promise.resolve()
  const cancellation = model.cancel()
  const second = model.start()
  await Promise.resolve()
  expect(deps.startDictation).toHaveBeenCalledOnce()
  release()
  await Promise.all([first, cancellation, second])
  expect(deps.startDictation).toHaveBeenCalledTimes(2)
  expect(model.stage.value).toBe('recording')
  expect(deps.run).not.toHaveBeenCalled()
})

it('waits for cleanup after recognition failure before starting another recording', async () => {
  const { model, deps } = setup()
  let handlers!: Parameters<VoiceCommandDependencies['startDictation']>[0]
  deps.startDictation = vi.fn(async (next) => {
    handlers = next
  })
  await model.start()
  const oldHandlers = handlers
  let release!: () => void
  deps.cancelDictation = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  oldHandlers.onText({ committed: '', draft: 'save note Keep this' })
  oldHandlers.onError(new Error('Connection lost'))
  const restarting = model.start()
  await Promise.resolve()
  expect(deps.startDictation).toHaveBeenCalledOnce()
  release()
  await restarting
  expect(deps.startDictation).toHaveBeenCalledTimes(2)
  oldHandlers.onText({ committed: '', draft: 'save note Stale' })
  oldHandlers.onError(new Error('Stale failure'))
  expect(model.transcript.value).toBe('save note Keep this')
  expect(model.error.value).toBe('')
  expect(model.stage.value).toBe('recording')
  expect(deps.run).not.toHaveBeenCalled()
})

it('does not automatically execute a manually recovered parameter', async () => {
  const { model, deps, commands } = setup()
  deps.finishDictation = vi.fn(async () => 'unknown input')
  await model.start()
  await model.finish()
  model.choose({
    commandId: commands[0]!.id,
    parameters: { language: 'en-US' },
    text: 'Hello!',
    consumedWordCount: 0,
    textOffset: 0,
    commandOffset: 0,
  })
  expect(deps.run).not.toHaveBeenCalled()
  expect(model.canRun.value).toBe(true)
  await model.run()
  expect(deps.run).toHaveBeenCalledOnce()
})

it('automatically runs the final exact command by default', async () => {
  const { model, deps, partial } = setup()
  await model.start()
  partial('save note Draft')
  expect(deps.run).not.toHaveBeenCalled()
  await model.finish()
  expect(deps.run).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: 'note' }),
    'Hello!',
    expect.any(AbortSignal)
  )
})

it('waits for review when the final transcript names another command', async () => {
  const { model, deps, partial } = setup({
    finishDictation: vi.fn(async () => 'translate to English Hello!'),
  })
  await model.start()
  partial('save note Hello')
  await model.finish()
  expect(deps.run).not.toHaveBeenCalled()
  expect(model.stage.value).toBe('review')
  expect(model.command.value?.id).toBe('builtin:voice:translate:en-US')
})

it('does not run a command that was not recognized when finished to run', async () => {
  const { model, deps } = setup()
  await model.start()
  await model.finish('run')
  expect(deps.run).not.toHaveBeenCalled()
  expect(model.stage.value).toBe('review')
  expect(model.command.value?.id).toBe('note')
})

it('waits for manual execution when finished for review', async () => {
  const { model, deps } = setup()
  await model.start()
  await model.finish('review')
  expect(deps.run).not.toHaveBeenCalled()
  await model.run()
  expect(deps.run).toHaveBeenCalledOnce()
})

it('keeps the whole unmatched transcript in the field for a manual choice', async () => {
  const { model, deps } = setup()
  deps.finishDictation = vi.fn(async () => 'unknown input')
  await model.start()
  await model.finish()
  expect(model.inputText.value).toBe('unknown input')
  model.inputText.value = 'edited input'
  model.chooseCommand('note')
  expect(model.inputText.value).toBe('edited input')
  expect(deps.run).not.toHaveBeenCalled()
})

it('reports an empty recording without choosing a command', async () => {
  const { model, deps } = setup()
  deps.finishDictation = vi.fn(async () => '  ')
  await model.start()
  await model.finish()
  expect(model.error.value).toBe('voiceCommands.nothingHeard')
  expect(model.selected.value).toBeUndefined()
})

it('switches the chosen command without losing the edited text', async () => {
  const { model, commands } = setup()
  commands.push({ ...commands[0]!, id: 'sibling', phrases: ['other'] })
  await model.start()
  await model.finish('review')
  model.inputText.value = 'Edited'
  model.switchCommand('sibling')
  expect(model.command.value?.id).toBe('sibling')
  expect(model.inputText.value).toBe('Edited')
})

it('progresses from awaiting-command to capturing-args when command is spoken or repeated', async () => {
  const { model, partial } = setup()
  await model.start()
  expect(model.recordingPhase.value).toBe('awaiting-command')
  expect(model.hasMatchedCommand.value).toBe(false)
  expect(model.activeCommand.value).toBeUndefined()

  partial('something incomplete')
  expect(model.recordingPhase.value).toBe('awaiting-command')
  expect(model.hasMatchedCommand.value).toBe(false)

  partial('save note')
  expect(model.recordingPhase.value).toBe('capturing-args')
  expect(model.hasMatchedCommand.value).toBe(true)
  expect(model.activeCommand.value?.id).toBe('note')
  expect(model.canRunLive.value).toBe(false)

  partial('save note Buy milk and bread')
  expect(model.recordingPhase.value).toBe('capturing-args')
  expect(model.hasMatchedCommand.value).toBe(true)
  expect(model.canRunLive.value).toBe(true)
  expect(model.activeCandidate.value?.text).toBe('Buy milk and bread')
})

it('considers command recognized during recording even when a parameter has an error', async () => {
  const { model, partial } = setup()
  await model.start()
  expect(model.hasMatchedCommand.value).toBe(false)
  expect(model.canRunLive.value).toBe(false)

  // Spoken phrase matches translate, but language parameter is unrecognized
  partial('translate to Klingon Hello!')
  expect(model.resolution.value.kind).toBe('parameter-error')
  expect(model.hasMatchedCommand.value).toBe(true)
  expect(model.recordingPhase.value).toBe('capturing-args')
  expect(model.activeCommand.value).toBeDefined()
  expect(model.canRunLive.value).toBe(true)
})

it('clears previous session transcript on cancel so reopening starts without active command', async () => {
  const { model, partial } = setup()
  await model.start()
  partial('save note Hello!')
  expect(model.hasMatchedCommand.value).toBe(true)
  expect(model.canRunLive.value).toBe(true)

  await model.cancel()
  expect(model.transcript.value).toBe('')
  expect(model.hasMatchedCommand.value).toBe(false)
  expect(model.canRunLive.value).toBe(false)

  await model.start()
  expect(model.hasMatchedCommand.value).toBe(false)
  expect(model.canRunLive.value).toBe(false)
  expect(model.recordingPhase.value).toBe('awaiting-command')
})

it('keeps what was heard when the session breaks while recording', async () => {
  const { model, deps } = setup()
  let handlers!: Parameters<VoiceCommandDependencies['startDictation']>[0]
  deps.startDictation = vi.fn(async (next) => {
    handlers = next
  })
  await model.start()
  handlers.onText({ committed: 'save note Keep', draft: 'this' })
  handlers.onError(new Error('Connection lost'))
  await Promise.resolve()

  expect(model.stage.value).toBe('review')
  expect(model.inputText.value).toBe('Keep this')
  expect(model.command.value?.id).toBe('note')
  expect(model.error.value).toBe('Connection lost')
  expect(deps.cancelDictation).toHaveBeenCalled()
  expect(deps.run).not.toHaveBeenCalled()
})

it('settles the text of a session that broke while finishing without running it', async () => {
  const { model, deps } = setup()
  let handlers!: Parameters<VoiceCommandDependencies['startDictation']>[0]
  deps.startDictation = vi.fn(async (next) => {
    handlers = next
  })
  let release!: (text: string) => void
  deps.finishDictation = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        release = resolve
      })
  )
  await model.start()
  const finishing = model.finish('run')
  await Promise.resolve()
  await Promise.resolve()
  handlers.onError(new Error('Timed out'))
  release('save note Hello')
  await finishing

  expect(model.stage.value).toBe('review')
  expect(model.inputText.value).toBe('Hello')
  expect(model.error.value).toBe('Timed out')
  expect(deps.run).not.toHaveBeenCalled()
})

it('passes selection context to deps.run and blocks commands requiring selection when context is missing', async () => {
  const selectionCommand = {
    ...createCommand('script', 'with-sel'),
    isVoiceEnabled: true,
    phrases: ['summarize'],
    toolConfig: { command: 'echo {{SELECTION}} - {{TEXT}}' },
  }
  const { model, deps } = setup({
    commands: () => [selectionCommand],
    finishDictation: vi.fn(async () => 'summarize details'),
  })

  await model.start()
  await model.finish('review')

  expect(model.stage.value).toBe('review')
  expect(model.command.value?.id).toBe('with-sel')
  expect(model.inputIssue.value).toBe('missing-selection')
  expect(model.canRun.value).toBe(false)

  await model.run()
  expect(deps.run).not.toHaveBeenCalled()

  model.setContext({ selectionText: 'Selected passage' })
  expect(model.inputIssue.value).toBeUndefined()
  expect(model.canRun.value).toBe(true)

  await model.run()
  expect(deps.run).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'with-sel' }),
    'details',
    expect.any(AbortSignal),
    { selectionText: 'Selected passage' }
  )
})
