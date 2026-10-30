import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_BOUNDARY_COOLDOWN_MS,
  DEFAULT_LIVE_DEBOUNCE_MS,
  DEFAULT_TYPING_TIMEOUT_MS,
  createLiveCorrection,
} from './live-correction'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface TestSetupOptions {
  debounceMs?: number
  boundaryCooldownMs?: number
  typingTimeoutMs?: number
}

function setup(options: TestSetupOptions = {}) {
  let currentTime = 1000
  let pendingTimer: (() => void) | null = null

  const deps = {
    correct: vi.fn(
      async (text: string, _signal: AbortSignal) => `Fixed: ${text}`
    ),
    setTimer: vi.fn((run: () => void, _delay: number) => {
      pendingTimer = run
      return 123
    }),
    clearTimer: vi.fn(() => {
      pendingTimer = null
    }),
    now: vi.fn(() => currentTime),
    debounceMs: options.debounceMs ?? DEFAULT_LIVE_DEBOUNCE_MS,
    boundaryCooldownMs:
      options.boundaryCooldownMs ?? DEFAULT_BOUNDARY_COOLDOWN_MS,
    typingTimeoutMs: options.typingTimeoutMs ?? DEFAULT_TYPING_TIMEOUT_MS,
  }

  const model = createLiveCorrection(deps)

  const advanceTime = (ms: number) => {
    currentTime += ms
  }

  const fireTimer = () => {
    if (pendingTimer) {
      const run = pendingTimer
      pendingTimer = null
      run()
    }
  }

  return {
    deps,
    model,
    advanceTime,
    fireTimer,
    getCurrentTime: () => currentTime,
  }
}

describe('createLiveCorrection', () => {
  it('starts in idle status with empty corrected text', () => {
    const { model } = setup()
    expect(model.status.value).toBe('idle')
    expect(model.correctedText.value).toBe('')
  })

  it('resets when text is empty or blank', () => {
    const { deps, model } = setup()
    model.handleInput('   ')
    expect(deps.setTimer).not.toHaveBeenCalled()
    expect(model.status.value).toBe('idle')
    expect(model.correctedText.value).toBe('')
  })

  it('debounces rapid typing and summarizes remaining characters once paused', async () => {
    const { deps, model, fireTimer, advanceTime } = setup()

    model.handleInput('Hell')
    expect(deps.setTimer).toHaveBeenCalledOnce()
    expect(deps.correct).not.toHaveBeenCalled()

    advanceTime(100)
    model.handleInput('Hello')
    expect(deps.clearTimer).toHaveBeenCalledOnce()
    expect(deps.setTimer).toHaveBeenCalledTimes(2)

    // User stops typing, debounce timer triggers
    advanceTime(DEFAULT_LIVE_DEBOUNCE_MS)
    fireTimer()

    expect(deps.correct).toHaveBeenCalledOnce()
    expect(deps.correct).toHaveBeenCalledWith('Hello', expect.any(AbortSignal))
    expect(model.status.value).toBe('loading')

    await vi.waitFor(() => expect(model.status.value).toBe('ready'))
    expect(model.correctedText.value).toBe('Fixed: Hello')

    // If user paused and doesn't type further, no new request is sent
    model.handleInput('Hello')
    expect(deps.correct).toHaveBeenCalledOnce()
  })

  it('triggers early on sentence punctuation followed by a space', async () => {
    const { deps, model, advanceTime } = setup()

    advanceTime(2000)
    model.handleInput('Hello world. ')

    // Should fire immediately without waiting for debounce timer
    expect(deps.correct).toHaveBeenCalledOnce()
    expect(deps.correct).toHaveBeenCalledWith(
      'Hello world. ',
      expect.any(AbortSignal)
    )
    expect(model.status.value).toBe('loading')

    await vi.waitFor(() => expect(model.status.value).toBe('ready'))
    expect(model.correctedText.value).toBe('Fixed: Hello world. ')
  })

  it('triggers on clause boundary (comma + space) when cooldown has passed', async () => {
    const { deps, model, advanceTime } = setup()

    advanceTime(2000)
    model.handleInput('After that, ')

    expect(deps.correct).toHaveBeenCalledOnce()
    expect(deps.correct).toHaveBeenCalledWith(
      'After that, ',
      expect.any(AbortSignal)
    )
  })

  it('triggers on word boundary when typing continues past timeout', async () => {
    const { deps, model, advanceTime, fireTimer } = setup()

    advanceTime(2000)
    model.handleInput('Start')
    advanceTime(DEFAULT_TYPING_TIMEOUT_MS + 100)
    model.handleInput('Start continuing ')

    expect(deps.correct).toHaveBeenCalledOnce()
    expect(deps.correct).toHaveBeenCalledWith(
      'Start continuing ',
      expect.any(AbortSignal)
    )

    // User adds more characters, pauses: summarized on debounce
    await vi.waitFor(() => expect(model.status.value).toBe('ready'))
    model.handleInput('Start continuing more')
    advanceTime(DEFAULT_LIVE_DEBOUNCE_MS)
    fireTimer()

    expect(deps.correct).toHaveBeenCalledTimes(2)
    expect(deps.correct).toHaveBeenLastCalledWith(
      'Start continuing more',
      expect.any(AbortSignal)
    )
  })

  it('respects boundary cooldown to prevent spamming requests', async () => {
    const { deps, model, advanceTime } = setup()

    advanceTime(2000)
    model.handleInput('Sentence one. ')
    expect(deps.correct).toHaveBeenCalledOnce()

    // Another punctuation typed immediately (less than cooldown)
    advanceTime(200)
    model.handleInput('Sentence one. Wait! ')
    // Should NOT trigger immediately; should schedule debounce instead
    expect(deps.correct).toHaveBeenCalledOnce()
    expect(deps.setTimer).toHaveBeenCalled()
  })

  it('aborts previous in-flight request when a newer one starts', async () => {
    const { deps, model, fireTimer, advanceTime } = setup()
    const firstRequest = deferred<string>()
    deps.correct.mockImplementationOnce(() => firstRequest.promise)

    model.handleInput('Part1')
    advanceTime(DEFAULT_LIVE_DEBOUNCE_MS)
    fireTimer()

    expect(deps.correct).toHaveBeenCalledTimes(1)
    const firstSignal = deps.correct.mock.calls[0]![1] as AbortSignal
    expect(firstSignal.aborted).toBe(false)

    // Second request triggered
    advanceTime(2000)
    model.handleInput('Part1 completed. ')
    expect(firstSignal.aborted).toBe(true)
    expect(deps.correct).toHaveBeenCalledTimes(2)
  })

  it('provides getFinalCorrection from cache if already resolved', async () => {
    const { deps, model, fireTimer, advanceTime } = setup()

    model.handleInput('Complete sentence')
    advanceTime(DEFAULT_LIVE_DEBOUNCE_MS)
    fireTimer()
    await vi.waitFor(() => expect(model.status.value).toBe('ready'))

    // getFinalCorrection resolves immediately without extra call
    const finalResult = await model.getFinalCorrection('Complete sentence')
    expect(finalResult).toBe('Fixed: Complete sentence')
    expect(deps.correct).toHaveBeenCalledOnce()
  })

  it('awaits in-flight request on getFinalCorrection', async () => {
    const { deps, model, fireTimer, advanceTime } = setup()
    const inFlight = deferred<string>()
    deps.correct.mockImplementationOnce(() => inFlight.promise)

    model.handleInput('Pending input')
    advanceTime(DEFAULT_LIVE_DEBOUNCE_MS)
    fireTimer()

    expect(model.status.value).toBe('loading')
    const finalPromise = model.getFinalCorrection('Pending input')
    inFlight.resolve('Fixed: Pending input')

    const result = await finalPromise
    expect(result).toBe('Fixed: Pending input')
  })

  it('sends immediate request on getFinalCorrection if pending characters were not sent', async () => {
    const { deps, model } = setup()

    model.handleInput('Fast typed text')
    // Enter pressed before debounce fires
    const result = await model.getFinalCorrection('Fast typed text')
    expect(deps.correct).toHaveBeenCalledWith(
      'Fast typed text',
      expect.any(AbortSignal)
    )
    expect(result).toBe('Fixed: Fast typed text')
  })

  it('handles errors cleanly without breaking state', async () => {
    const { deps, model, fireTimer, advanceTime } = setup()
    deps.correct.mockRejectedValueOnce(new Error('Network error'))

    model.handleInput('Broken')
    advanceTime(DEFAULT_LIVE_DEBOUNCE_MS)
    fireTimer()

    await vi.waitFor(() => expect(model.status.value).toBe('error'))
    expect(model.error.value).toBeInstanceOf(Error)
  })

  it('cancels and resets on dispose', () => {
    const { deps, model } = setup()
    model.handleInput('Hello')
    model.dispose()

    expect(deps.clearTimer).toHaveBeenCalled()
    expect(model.status.value).toBe('idle')
    expect(model.correctedText.value).toBe('')
  })
})
