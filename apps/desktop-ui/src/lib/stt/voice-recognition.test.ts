import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createVoiceRecognition,
  type VoiceRecognitionDeps,
} from './voice-recognition'

function setup(overrides: Partial<VoiceRecognitionDeps> = {}) {
  const deps: VoiceRecognitionDeps = {
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
    toast: vi.fn(),
    toastText: vi.fn(),
    ...overrides,
  }
  const model = createVoiceRecognition(deps)
  return { deps, model }
}
afterEach(() => vi.useRealTimers())

describe('voice recognition model', () => {
  it('saves raw text before formatting and emits the requested finish intent', async () => {
    vi.useFakeTimers()
    const { deps, model } = setup()
    await model.startSession()
    await model.finish('next')
    expect(deps.saveSource).toHaveBeenCalledWith(
      'Raw words',
      'voice-correction'
    )
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
