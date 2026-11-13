import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictationError } from './dictation-error'
import type { LiveDictationStart } from './live-dictation'
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
  it('hands raw dictated text to editing without running correction', async () => {
    const { deps, model } = setup()
    await model.startSession()
    await model.finish('edit')
    expect(deps.voiceCorrection).not.toHaveBeenCalled()
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Raw words',
      'Raw words',
      undefined,
      'edit'
    )
    model.dispose()
  })

  it('opens a prompt input after silent dictation and tells nothing was recognized', async () => {
    const { deps, model } = setup({
      options: () => ({ chat: true, allowEmptyInput: true }),
      finishDictation: vi.fn().mockResolvedValue(''),
    })
    await model.startSession()
    await model.finish('insert')
    expect(deps.onCorrected).toHaveBeenCalledWith('', '', undefined, 'insert')
    expect(deps.onCancelled).not.toHaveBeenCalled()
    // the input opens empty, so the user is told why
    expect(deps.toastKey).toHaveBeenCalledWith(
      'toast.nothingRecognized',
      'warn'
    )
    model.dispose()
  })

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
  it('returns existing chat input to editing when no speech was recognized', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup({
      options: () => ({ chat: true, prefix: 'Existing question' }),
      finishDictation: async () => '',
    })
    await model.startSession()
    await model.finish('submit')
    expect(deps.onCorrected).toHaveBeenCalledWith('', '', undefined, 'edit')
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

  it('corrects finalized Live text for editable targets without the legacy pass', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        edits: [
          {
            old: 'Call Jon tomorrow.',
            new: 'Call John tomorrow.',
            reason: 'Misspelled name',
          },
        ],
      })
    const { model, deps, handlers } = await started({
      shouldFormatRecognizedText: () => false,
      shouldCorrectContextually: () => true,
      contextualVoiceCorrection: request,
      finishDictation: vi.fn().mockResolvedValue('Call Jon tomorrow.'),
    })
    handlers.onText({ committed: '', draft: 'Call Jon' })
    expect(request).not.toHaveBeenCalled()
    handlers.onText({ committed: 'Call Jon tomorrow.', draft: '' })
    await vi.waitFor(() =>
      expect(model.transcript.value.committed).toBe('Call John tomorrow.')
    )
    handlers.onText({ committed: 'Call Jon tomorrow.', draft: 'Then' })
    expect(model.transcript.value).toEqual({
      committed: 'Call John tomorrow.',
      draft: 'Then',
    })
    await model.finish('submit')
    expect(deps.voiceCorrection).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
    expect(deps.saveSource).toHaveBeenCalledWith(
      'Call Jon tomorrow.',
      'voiceCorrection'
    )
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Call John tomorrow.',
      'Call Jon tomorrow.',
      'Call John tomorrow.',
      'submit'
    )
    model.dispose()
  })

  it('runs the final contextual pass over the final audio and styles its result separately', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        edits: [
          {
            old: 'Call Jon tomorrow.',
            new: 'Call John tomorrow.',
            reason: 'Misspelled name',
          },
        ],
      })
    const voiceStyling = vi.fn().mockResolvedValue('Styled text')
    const { model, deps, handlers } = await started({
      shouldCorrectContextually: () => true,
      contextualVoiceCorrection: request,
      voiceStyling,
      finishDictation: vi.fn().mockResolvedValue('Call Jon tomorrow.'),
    })
    handlers.onText({ committed: '', draft: 'Call Jon tomorrow' })
    await model.finishWithStyle('Formal')
    expect(request).toHaveBeenCalledOnce()
    expect(voiceStyling).toHaveBeenCalledWith(
      'Call John tomorrow.',
      'Formal',
      expect.any(AbortSignal)
    )
    expect(deps.voiceCorrection).not.toHaveBeenCalled()
    model.dispose()
  })

  it('cancels in-flight contextual work on restart and rejects its late reply', async () => {
    let resolve!: (value: unknown) => void
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const { model, handlers } = await started({
      shouldCorrectContextually: () => true,
      contextualVoiceCorrection: request,
    })
    handlers.onText({ committed: 'Call Jon tomorrow.', draft: '' })
    await model.restartSession()
    resolve({
      edits: [
        {
          old: 'Call Jon tomorrow.',
          new: 'Call John tomorrow.',
          reason: 'Misspelled name',
        },
      ],
    })
    await Promise.resolve()
    expect(model.transcript.value).toEqual({ committed: '', draft: '' })
    expect(request.mock.calls[0][1].aborted).toBe(true)
    model.dispose()
  })

  it('keeps intermediate contextual corrections when the final pass times out', async () => {
    vi.useFakeTimers()
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        edits: [
          {
            old: 'Call Jon tomorrow.',
            new: 'Call John tomorrow.',
            reason: 'Misspelled name',
          },
        ],
      })
      .mockImplementationOnce(() => new Promise(() => {}))
    const { model, deps, handlers } = await started({
      shouldCorrectContextually: () => true,
      contextualVoiceCorrection: request,
      finishDictation: vi
        .fn()
        .mockResolvedValue('Call Jon tomorrow. More words.'),
      postProcessTimeoutMs: 500,
    })
    handlers.onText({ committed: 'Call Jon tomorrow.', draft: '' })
    await vi.waitFor(() =>
      expect(model.transcript.value.committed).toBe('Call John tomorrow.')
    )
    const finishing = model.finish('insert')
    await vi.advanceTimersByTimeAsync(500)
    await finishing
    expect(deps.toastKey).toHaveBeenCalledWith(
      'toast.voicePostProcessTimeout',
      'warn'
    )
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Call John tomorrow. More words.',
      'Call Jon tomorrow. More words.',
      'Call John tomorrow. More words.',
      'insert'
    )
    model.dispose()
    vi.useRealTimers()
  })

  it('reports contextual correction error at most once per dictation session', async () => {
    const request = vi.fn().mockRejectedValue(new Error('LLM down'))
    const { model, deps, handlers } = await started({
      shouldCorrectContextually: () => true,
      contextualVoiceCorrection: request,
    })
    handlers.onText({ committed: 'First chunk.', draft: '' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    handlers.onText({ committed: 'First chunk. Second chunk.', draft: '' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(deps.toastKey).toHaveBeenCalledTimes(1)
    expect(deps.toastKey).toHaveBeenCalledWith(
      'toast.voiceContextualCorrectionFailed',
      'error'
    )
    model.dispose()
  })

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

  it('does not offer to keep or drop the text of a session that broke while finishing', async () => {
    vi.useFakeTimers()
    let resolveFinish!: (text: string) => void
    const { deps, model, handlers } = await started({
      shouldFormatRecognizedText: () => false,
      finishDictation: vi.fn(
        () =>
          new Promise<string>((done) => {
            resolveFinish = done
          })
      ),
    })
    handlers.onText({ committed: 'Heard', draft: '' })
    const finishing = model.finish()
    await vi.waitFor(() => expect(deps.finishDictation).toHaveBeenCalled())
    handlers.onError(new DictationError('timeout', 'Timed out'))
    await vi.waitFor(() =>
      expect(deps.toastText).toHaveBeenCalledWith(
        'toast.dictationTimeout',
        'error'
      )
    )
    resolveFinish('Heard')
    await finishing
    expect(deps.onCorrected).toHaveBeenCalled()
  })

  it('does not start over a broken session that still holds its text', async () => {
    vi.useFakeTimers()
    const { deps, model, handlers } = await started()
    handlers.onText({ committed: 'Heard', draft: '' })
    handlers.onError(new Error('Network'))
    await vi.waitFor(() => expect(model.isStarted.value).toBe(false))
    await model.startSession()
    expect(deps.startDictation).toHaveBeenCalledOnce()
    expect(model.transcript.value.committed).toBe('Heard')
    model.dispose()
  })

  it('tells about a cancellation once when the finish times out without text', async () => {
    vi.useFakeTimers()
    let fail!: (error: Error) => void
    const { deps, model, handlers } = await started({
      finishDictation: () =>
        new Promise<string>((_, reject) => {
          fail = reject
        }),
    })
    const finishing = model.finish()
    await vi.waitFor(() => {
      expect(model.isStarted.value).toBe(false)
      expect(model.isTranscribing.value).toBe(true)
    })
    const timeout = new DictationError('timeout', 'Timed out')
    handlers.onError(timeout)
    await vi.waitFor(() => expect(deps.onCancelled).toHaveBeenCalled())
    fail(timeout)
    await finishing
    expect(deps.onCancelled).toHaveBeenCalledOnce()
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

  it('keeps silent recordings available for retry when supported', async () => {
    const onEmptyInput = vi.fn()
    const { deps, model } = await started({
      finishDictation: async () => '',
      onEmptyInput,
    })
    await model.finish('submit')
    expect(onEmptyInput).toHaveBeenCalledOnce()
    expect(deps.onCancelled).not.toHaveBeenCalled()
    expect(deps.onCorrected).not.toHaveBeenCalled()
    await model.startSession()
    expect(model.isStarted.value).toBe(true)
    model.dispose()
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

  it('keeps the source in history without delivering cancelled correction', async () => {
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
    expect(model.isStarted.value).toBe(false)
    expect(model.isTranscribing.value).toBe(false)
    expect(model.isCorrecting.value).toBe(true)
    vi.mocked(deps.setPendingModal).mock.calls[0]![0].onCancel()
    await finishing
    await vi.waitFor(() => expect(deps.onCancelled).toHaveBeenCalledOnce())
    expect(deps.saveSource).toHaveBeenCalledWith('Raw words', 'voiceCorrection')
    expect(deps.onCorrected).not.toHaveBeenCalled()
  })

  it('preserves chat input that is only after the caret', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup({
      finishDictation: vi.fn().mockResolvedValue(''),
      options: () => ({ chat: true, prefix: '', suffix: 'question' }),
    })
    await model.startSession()
    await model.finish('submit')
    expect(deps.onCorrected).toHaveBeenCalledWith('', '', undefined, 'edit')
  })

  it('stops at the recording limit', async () => {
    vi.useFakeTimers()
    const { deps, handlers } = await started({
      shouldFormatRecognizedText: () => false,
    })
    // speech every two minutes keeps the silence stop away
    for (let minute = 2; minute <= 60; minute += 2) {
      await vi.advanceTimersByTimeAsync(120_000)
      handlers.onText({ committed: `word ${minute}`, draft: '' })
    }
    await vi.advanceTimersByTimeAsync(1_000)
    expect(deps.toastKey).toHaveBeenCalledWith(
      'toast.recordingLimitReached',
      'warn'
    )
    await vi.waitFor(() =>
      expect(deps.onCorrected).toHaveBeenCalledWith(
        'Raw words',
        'Raw words',
        undefined,
        'next'
      )
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops after three minutes without recognized speech', async () => {
    vi.useFakeTimers()
    const { deps, handlers } = await started({
      shouldFormatRecognizedText: () => false,
    })
    await vi.advanceTimersByTimeAsync(100_000)
    handlers.onText({ committed: '', draft: 'Heard' })
    // empty results and retracted draft guesses arrive in silence too and do
    // not count as speech
    await vi.advanceTimersByTimeAsync(100_000)
    handlers.onText({ committed: '', draft: '' })
    handlers.onText({ committed: '', draft: '' })
    // the silence counts from the last new words, at 100 s
    await vi.advanceTimersByTimeAsync(79_000)
    expect(deps.toastKey).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(deps.toastKey).toHaveBeenCalledWith(
      'toast.recordingSilenceStop',
      'warn'
    )
    await vi.waitFor(() =>
      expect(deps.onCorrected).toHaveBeenCalledWith(
        'Raw words',
        'Raw words',
        undefined,
        'next'
      )
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('warns twenty seconds before an automatic stop', async () => {
    vi.useFakeTimers()
    const { model, handlers } = await started()
    const startedAt = Date.now()
    await vi.advanceTimersByTimeAsync(159_999)
    expect(model.autoStopWarning.value).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    expect(model.autoStopWarning.value).toEqual({
      reason: 'silence',
      deadlineMs: startedAt + 180_000,
    })

    // speech pushes the stop away and hides the countdown
    handlers.onText({ committed: 'Back', draft: '' })
    expect(model.autoStopWarning.value).toBeUndefined()

    await model.finish()
    expect(model.autoStopWarning.value).toBeUndefined()
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

  it('enables buffered intent during voice post-processing and emits a buffered slot action', async () => {
    const slotIntent = {
      slotIndex: 8,
      key: 'F',
      label: 'action.transformationMenu',
      icon: 'mdi:auto-fix',
    }
    const { deps, model } = setup({ consumeBufferedIntent: () => slotIntent })
    await model.startSession()
    await model.finish('insert')
    expect(deps.setPendingModal).toHaveBeenCalledWith(
      expect.objectContaining({ correction: true, allowBufferedIntent: true })
    )
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Formatted words.',
      'Raw words',
      'Formatted words.',
      slotIntent
    )
    model.dispose()
  })

  it('saves raw recognized text to history even when formatting is disabled', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup({ shouldFormatRecognizedText: () => false })
    await model.startSession()
    await model.finish('insert')
    expect(deps.saveSource).toHaveBeenCalledWith('Raw words', 'voiceCorrection')
    expect(deps.saveSourceResult).not.toHaveBeenCalled()
    expect(deps.voiceCorrection).not.toHaveBeenCalled()
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Raw words',
      'Raw words',
      undefined,
      'insert'
    )
    model.dispose()
  })

  it('uses the same cancel action during post-processing', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup()
    await model.startSession()
    await model.finish()
    expect(deps.setPendingModal).toHaveBeenCalledWith(
      expect.objectContaining({
        correction: true,
        cancelLabel: 'common.cancel',
      })
    )
    model.dispose()
  })

  it('times out post-processing when the model hangs, warning and falling back to raw text', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup({
      voiceCorrection: vi.fn(() => new Promise<string>(() => {})),
      postProcessTimeoutMs: 5000,
    })
    await model.startSession()
    const finishing = model.finish('next')
    await vi.advanceTimersByTimeAsync(5100)
    await finishing
    expect(deps.toastKey).toHaveBeenCalledWith(
      'toast.voicePostProcessTimeout',
      'warn'
    )
    expect(deps.onCorrected).toHaveBeenCalledWith(
      'Raw words',
      'Raw words',
      undefined,
      'next'
    )
    expect(deps.clearPendingModal).toHaveBeenCalledWith(7)
    model.dispose()
  })
})

it('checkpoints live speech and preserves cancellation in the same history record', async () => {
  vi.useFakeTimers()
  let handlers!: Pick<LiveDictationStart, 'onText' | 'onError'>
  const saveCheckpoint = vi.fn().mockResolvedValue('voice-draft')
  const { model, deps } = setup({
    saveCheckpoint,
    startDictation: async (next) => {
      handlers = next
    },
  })
  await model.startSession()
  handlers.onText({ committed: 'Long dictation', draft: 'in progress' })
  await vi.advanceTimersByTimeAsync(5000)
  expect(saveCheckpoint).toHaveBeenLastCalledWith({
    id: undefined,
    text: 'Long dictation in progress',
    kind: 'draft',
    operation: undefined,
  })
  handlers.onText({ committed: 'Long dictation', draft: 'last words' })
  await model.cancel()
  await model.flushHistory()
  expect(saveCheckpoint).toHaveBeenLastCalledWith({
    id: 'voice-draft',
    text: 'Long dictation last words',
    kind: 'draft',
    operation: undefined,
  })
  expect(deps.onCorrected).not.toHaveBeenCalled()
  expect(deps.onCancelled).toHaveBeenCalledOnce()
  model.dispose()
})

describe('abandoned dictation', () => {
  it('hands over the text of a dictation disposed while recording', async () => {
    let handlers!: Pick<LiveDictationStart, 'onText' | 'onError'>
    const onAbandoned = vi.fn()
    const { model } = setup({
      onAbandoned,
      startDictation: async (next) => {
        handlers = next
      },
    })
    await model.startSession()
    handlers.onText({ committed: 'Spoken words', draft: '' })
    model.dispose()
    expect(onAbandoned).toHaveBeenCalledWith('Spoken words')
  })

  it('hands over the recognized text of a dictation disposed while finishing', async () => {
    const onAbandoned = vi.fn()
    let correct!: (text: string) => void
    const { deps, model } = setup({
      onAbandoned,
      voiceCorrection: () =>
        new Promise<string>((resolve) => {
          correct = resolve
        }),
    })
    await model.startSession()
    const finishing = model.finish()
    await vi.waitFor(() => expect(correct).toBeTypeOf('function'))
    model.dispose()
    correct('Too late.')
    await finishing
    expect(onAbandoned).toHaveBeenCalledWith('Raw words')
    expect(deps.onCorrected).not.toHaveBeenCalled()
  })

  it('hands over nothing after a cancellation or a delivery', async () => {
    let handlers!: Pick<LiveDictationStart, 'onText' | 'onError'>
    const onAbandoned = vi.fn()
    const { model } = setup({
      onAbandoned,
      startDictation: async (next) => {
        handlers = next
      },
    })
    await model.startSession()
    handlers.onText({ committed: 'Dropped on purpose', draft: '' })
    await model.cancel()
    model.dispose()

    const delivered = setup({ onAbandoned })
    await delivered.model.startSession()
    await delivered.model.finish()
    expect(delivered.deps.onCorrected).toHaveBeenCalledOnce()
    delivered.model.dispose()
    expect(onAbandoned).not.toHaveBeenCalled()
  })
})
