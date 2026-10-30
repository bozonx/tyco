import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictationError, type LiveDictationStart } from './live-dictation'
import {
  createVoiceRecognition,
  type VoiceRecognitionDependencies,
} from './voice-recognition'

function setup(overrides: Partial<VoiceRecognitionDependencies> = {}) {
  const deps: VoiceRecognitionDependencies = {
    startDictation: vi.fn().mockResolvedValue(undefined),
    finishDictation: vi.fn().mockResolvedValue('Raw words'),
    cancelDictation: vi.fn().mockResolvedValue(undefined),
    shouldFormatRecognizedText: () => true,
    voiceCorrection: vi.fn().mockResolvedValue('Formatted words.'),
    saveSource: vi.fn().mockResolvedValue('source-id'),
    saveSourceResult: vi.fn().mockResolvedValue(undefined),
    setPendingModal: vi.fn().mockReturnValue(7),
    clearPendingModal: vi.fn(),
    options: () => ({}),
    onCorrected: vi.fn(),
    onCancelled: vi.fn(),
    t: (key) => key,
    toastKey: vi.fn(),
    toastText: vi.fn(),
    ...overrides,
  }
  const model = createVoiceRecognition(deps)
  return { deps, model }
}
afterEach(() => vi.useRealTimers())

describe('voice recognition model', () => {
  it('restarts for a new activation without emitting cancellation', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup()
    await model.startSession()
    await model.restartSession()
    expect(deps.startDictation).toHaveBeenCalledTimes(2)
    expect(deps.onCancelled).not.toHaveBeenCalled()
    expect(model.isStarted.value).toBe(true)
    model.dispose()
  })

  it('honors user cancellation while a restart is stopping the microphone', async () => {
    vi.useFakeTimers()
    let resolve!: () => void
    const { deps, model } = setup()
    await model.startSession()
    vi.mocked(deps.cancelDictation).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        })
    )
    const restarting = model.restartSession()
    const cancelling = model.cancel()
    resolve()
    await Promise.all([restarting, cancelling])
    expect(deps.startDictation).toHaveBeenCalledOnce()
    expect(deps.onCancelled).toHaveBeenCalledOnce()
    model.dispose()
  })
  it('saves raw text before formatting and emits the requested finish intent', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup()
    await model.startSession()
    await model.finish('next')
    expect(deps.saveSource).toHaveBeenCalledWith('Raw words', 'voiceCorrection')
    expect(deps.saveSourceResult).toHaveBeenCalledWith(
      'source-id',
      'Formatted words.'
    )
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Formatted words.',
      'Raw words',
      'Formatted words.',
      'next'
    )
    expect(deps.clearPendingModal).toHaveBeenCalledWith(7)
    expect(model.isFinishing.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    model.dispose()
  })
  it('keeps raw text usable when formatting fails', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup({
      voiceCorrection: vi.fn().mockRejectedValue(new Error('Unavailable')),
    })
    await model.startSession()
    await model.finish()
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Raw words',
      'Raw words',
      undefined,
      'insert'
    )
    expect(deps.clearPendingModal).toHaveBeenCalledWith(7)
    model.dispose()
  })
  it('suppresses a late transcription after cancellation', async () => {
    vi.useFakeTimers()
    let resolve!: (value: string) => void
    const pending = new Promise<string>((done) => {
      resolve = done
    })
    const { deps, model } = setup({ finishDictation: () => pending })
    await model.startSession()
    const finishing = model.finish()
    await Promise.resolve()
    await model.cancel()
    resolve('Late words')
    await finishing
    expect(deps.onCorrected).not.toHaveBeenCalled()
    expect(deps.onCancelled).toHaveBeenCalledOnce()
    model.dispose()
  })
  it('does not start timers when disposed while the microphone is starting', async () => {
    vi.useFakeTimers()
    let resolve!: () => void
    const { deps, model } = setup({
      startDictation: () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    })
    const starting = model.startSession()
    model.dispose()
    resolve()
    await starting
    expect(model.isStarted.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(deps.onCorrected).not.toHaveBeenCalled()
  })
  it('can submit existing chat input even when no new speech was recognized', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup({
      options: () => ({ chat: true, prefix: 'Existing question' }),
      finishDictation: async () => '',
    })
    await model.startSession()
    await model.finish('submit')
    expect(deps.onCorrected).toHaveBeenCalledWith('', '', undefined, 'submit')
    expect(deps.onCancelled).not.toHaveBeenCalled()
    model.dispose()
  })
})

describe('voice recognition failures', () => {
  type Handlers = Pick<LiveDictationStart, 'onText' | 'onError'>
  /** Starts a session and hands back the handlers the provider received */
  async function started(
    overrides: Partial<VoiceRecognitionDependencies> = {}
  ) {
    let handlers!: Handlers
    const context = setup({
      startDictation: vi.fn(async (next: Handlers) => {
        handlers = next
      }),
      ...overrides,
    })
    await context.model.startSession()
    return { ...context, handlers }
  }

  it.each([
    [
      new DictationError('timeout', 'Slow'),
      'toastText',
      'toast.dictationTimeout',
    ],
    [new Error(''), 'toastKey', 'toast.voiceRecognitionFailed'],
  ] as const)('reports a failed start: %s', async (error, toast, message) => {
    vi.useFakeTimers()
    const { deps, model } = setup({
      startDictation: vi.fn().mockRejectedValue(error),
    })
    await model.startSession()
    expect(deps[toast]).toHaveBeenCalledWith(message, 'error')
    expect(deps.onCancelled).toHaveBeenCalledOnce()
    expect(model.isStarted.value).toBe(false)
  })

  it('cancels a session that failed before saying anything', async () => {
    vi.useFakeTimers()
    const { deps, model, handlers } = await started()
    handlers.onError(new DictationError('closed', 'Closed'))
    await vi.waitFor(() => expect(deps.onCancelled).toHaveBeenCalledOnce())
    expect(deps.toastText).toHaveBeenCalledWith(
      'toast.dictationClosed',
      'error'
    )
    expect(model.isStarted.value).toBe(false)
    model.dispose()
  })

  it('keeps the text heard before an interruption and finishes with it', async () => {
    vi.useFakeTimers()
    const { deps, model, handlers } = await started({
      shouldFormatRecognizedText: () => false,
    })
    handlers.onText({ committed: 'Heard', draft: '' })
    expect(model.transcript.value.committed).toBe('Heard')
    handlers.onError(new Error('Network'))
    await vi.waitFor(() =>
      expect(deps.toastText).toHaveBeenCalledWith(
        'Network\nmenu.dictationInterrupted',
        'error'
      )
    )
    expect(deps.onCancelled).not.toHaveBeenCalled()
    await model.finish()
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Raw words',
      'Raw words',
      undefined,
      'insert'
    )
    expect(deps.voiceCorrection).not.toHaveBeenCalled()
  })

  it('warns when nothing was recognized', async () => {
    vi.useFakeTimers()
    const { deps, model } = await started({
      finishDictation: vi.fn().mockResolvedValue('  '),
    })
    await model.finish()
    expect(deps.toastKey).toHaveBeenCalledWith(
      'toast.nothingRecognized',
      'warn'
    )
    expect(deps.onCancelled).toHaveBeenCalledOnce()
  })

  it('reports a failed transcription', async () => {
    vi.useFakeTimers()
    const { deps, model } = await started({
      finishDictation: vi.fn().mockRejectedValue(new Error('Lost')),
    })
    await model.finish()
    expect(deps.toastText).toHaveBeenCalledWith('Lost', 'error')
    expect(deps.onCancelled).toHaveBeenCalledOnce()
    expect(model.isFinishing.value).toBe(false)
  })

  it('treats finishing without a session as a cancellation', async () => {
    const { deps, model } = setup()
    await model.finish()
    expect(deps.finishDictation).not.toHaveBeenCalled()
    expect(deps.onCancelled).toHaveBeenCalledOnce()
  })

  it('formats text even when its history copy cannot be saved', async () => {
    vi.useFakeTimers()
    const { deps, model } = await started({
      saveSource: vi.fn().mockRejectedValue(new Error('Disk')),
      saveSourceResult: vi.fn().mockRejectedValue(new Error('Disk')),
    })
    await model.finish()
    expect(deps.toastKey).toHaveBeenCalledTimes(2)
    expect(deps.toastKey).toHaveBeenCalledWith(
      'history.operationFailed',
      'error'
    )
    expect(deps.saveSourceResult).toHaveBeenCalledWith(null, 'Formatted words.')
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Formatted words.',
      'Raw words',
      'Formatted words.',
      'insert'
    )
  })

  it('keeps the raw text when formatting returns nothing', async () => {
    vi.useFakeTimers()
    const { deps, model } = await started({
      voiceCorrection: vi.fn().mockResolvedValue(' '),
    })
    await model.finish()
    expect(deps.saveSourceResult).not.toHaveBeenCalled()
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Raw words',
      'Raw words',
      undefined,
      'insert'
    )
  })

  it('reports a failed cancellation and still settles', async () => {
    vi.useFakeTimers()
    const { deps, model } = await started({
      cancelDictation: vi.fn().mockRejectedValue(new Error('')),
    })
    await model.cancel()
    expect(deps.toastKey).toHaveBeenCalledWith(
      'toast.voiceRecognitionFailed',
      'error'
    )
    expect(deps.onCancelled).toHaveBeenCalledOnce()
    expect(model.isStarted.value).toBe(false)
  })

  it('leaves no recording limit behind when finished while starting', async () => {
    vi.useFakeTimers()
    let resolveStart!: () => void
    const { deps, model } = setup({
      shouldFormatRecognizedText: () => false,
      startDictation: vi.fn(
        () =>
          new Promise<void>((done) => {
            resolveStart = done
          })
      ),
    })
    const starting = model.startSession()
    const finishing = model.finish()
    resolveStart()
    await Promise.all([starting, finishing])
    expect(deps.onCorrected).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the recognized text when the user cancels its correction', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup({
      voiceCorrection: vi.fn(
        (_text: string, signal?: AbortSignal) =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new Error('aborted'))
            )
          })
      ),
    })
    await model.startSession()
    const finishing = model.finish()
    await vi.waitFor(() => expect(deps.setPendingModal).toHaveBeenCalled())
    vi.mocked(deps.setPendingModal).mock.calls[0]![0].onCancel()
    await finishing
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Raw words',
      'Raw words',
      undefined,
      'insert'
    )
    expect(deps.onCancelled).not.toHaveBeenCalled()
  })

  it('submits chat input that is only after the caret', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup({
      finishDictation: vi.fn().mockResolvedValue(''),
      options: () => ({ chat: true, prefix: '', suffix: 'question' }),
    })
    await model.startSession()
    await model.finish('submit')
    expect(deps.onCorrected).toHaveBeenCalledWith('', '', undefined, 'submit')
  })

  it('stops at the recording limit', async () => {
    vi.useFakeTimers()
    const { deps } = await started({ shouldFormatRecognizedText: () => false })
    await vi.advanceTimersByTimeAsync(3_601_000)
    expect(deps.toastKey).toHaveBeenCalledWith(
      'toast.recordingLimitReached',
      'warn'
    )
    await vi.waitFor(() => expect(deps.onCorrected).toHaveBeenCalled())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a second start while one is running', async () => {
    vi.useFakeTimers()
    const { deps, model } = await started()
    await model.startSession()
    expect(deps.startDictation).toHaveBeenCalledOnce()
    model.dispose()
    await model.startSession()
    expect(deps.startDictation).toHaveBeenCalledOnce()
  })

  it('finishes with style and uses next intent by default', async () => {
    const stylingFn = vi.fn().mockResolvedValue('Styled words')
    const { deps, model } = setup({ voiceStyling: stylingFn })
    await model.startSession()
    await model.finishWithStyle('make it punchy')
    expect(deps.saveSource).toHaveBeenCalledWith('Raw words', 'voiceCorrection')
    expect(deps.saveSourceResult).toHaveBeenCalledWith(
      'source-id',
      'Styled words'
    )
    expect(stylingFn).toHaveBeenCalledWith(
      'Raw words',
      'make it punchy',
      expect.anything()
    )
    expect(deps.setPendingModal).toHaveBeenCalledWith(
      expect.objectContaining({ styling: true })
    )
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Styled words',
      'Raw words',
      'Styled words',
      'next'
    )
    model.dispose()
  })

  it('styles text even when its history copy cannot be saved', async () => {
    const stylingFn = vi.fn().mockResolvedValue('Styled words')
    const { deps, model } = setup({
      voiceStyling: stylingFn,
      saveSource: vi.fn().mockRejectedValue(new Error('Disk full')),
      saveSourceResult: vi.fn().mockRejectedValue(new Error('Disk full')),
    })
    await model.startSession()
    await model.finishWithStyle('make it punchy')
    expect(deps.toastKey).toHaveBeenCalledWith(
      'history.operationFailed',
      'error'
    )
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Styled words',
      'Raw words',
      'Styled words',
      'next'
    )
    model.dispose()
  })

  it('finishes with style and uses insert intent when shouldInsertStyleDirectly returns true', async () => {
    const stylingFn = vi.fn().mockResolvedValue('Styled words')
    const { deps, model } = setup({
      voiceStyling: stylingFn,
      shouldInsertStyleDirectly: () => true,
    })
    await model.startSession()
    await model.finishWithStyle('make it punchy')
    expect(stylingFn).toHaveBeenCalledWith(
      'Raw words',
      'make it punchy',
      expect.anything()
    )
    expect(deps.setPendingModal).toHaveBeenCalledWith(
      expect.objectContaining({ styling: true })
    )
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Styled words',
      'Raw words',
      'Styled words',
      'insert'
    )
    model.dispose()
  })

  it('finishes with style and uses buffered intent when provided', async () => {
    const stylingFn = vi.fn().mockResolvedValue('Styled words')
    const { deps, model } = setup({
      voiceStyling: stylingFn,
      consumeBufferedIntent: () => 'insert',
    })
    await model.startSession()
    await model.finishWithStyle('make it punchy')
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Styled words',
      'Raw words',
      'Styled words',
      'insert'
    )
    model.dispose()
  })
})
