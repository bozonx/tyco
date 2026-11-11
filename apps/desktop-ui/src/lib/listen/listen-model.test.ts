import { describe, expect, it, vi } from 'vitest'

import type { DictationHandlers } from '../stt/dictation-controller'
import { SILENCE_TIMEOUT_MS } from '../stt/voice-session'
import {
  configuredListenSource,
  createListenModel,
  isSameSource,
  type ListenModelDependencies,
} from './listen-model'

function setup(overrides: Partial<ListenModelDependencies> = {}) {
  let handlers: DictationHandlers | undefined
  const timers: { run: () => void; at: number }[] = []
  let now = 0
  const deps = {
    now: () => now,
    setTimer: (run: () => void, delayMs: number) => {
      const timer = { run, at: now + delayMs }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer: unknown) => {
      const index = timers.indexOf(timer as (typeof timers)[number])
      if (index >= 0) timers.splice(index, 1)
    },
    startDictation: vi.fn(async (next: DictationHandlers) => {
      handlers = next
    }),
    finishDictation: vi.fn(async () => 'Hello there'),
    cancelDictation: vi.fn(async () => undefined),
    switchSource: vi.fn(async () => undefined),
    saveTranscript: vi.fn(async () => undefined),
    onAutoStop: vi.fn(),
    describeError: (error: unknown) => String(error),
    onClose: vi.fn(),
    ...overrides,
  }
  const model = createListenModel(deps)
  const advance = (ms: number) => {
    now += ms
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
      if (timer.at <= now && timers.includes(timer)) {
        timers.splice(timers.indexOf(timer), 1)
        timer.run()
      }
    }
  }
  return { model, deps, handlers: () => handlers!, advance }
}

describe('listen model', () => {
  it('keeps transferred words actionable when the new source fails to start', async () => {
    const { model } = setup({
      initialText: 'Keep these words',
      startDictation: vi.fn().mockRejectedValue(new Error('Unavailable')),
    })
    await model.start()
    expect(model.phase.value).toBe('result')
    expect(model.resultText.value).toBe('Keep these words')
    model.dispose()
  })

  it('keeps a draft from the previous source in live display and final text', async () => {
    const { model, handlers, deps } = setup({ initialText: 'From microphone.' })
    await model.start()
    expect(model.transcript.value.committed).toBe('From microphone.')
    handlers().onText({ committed: 'From audio', draft: 'now' })
    expect(model.transcript.value).toEqual({
      committed: 'From microphone. From audio',
      draft: 'now',
    })
    await model.stop()
    expect(model.resultText.value).toBe('From microphone. Hello there')
    expect(deps.saveTranscript).toHaveBeenCalledWith(
      'From microphone. Hello there'
    )
    model.dispose()
  })

  it('ignores recognition completed after closing the recording', async () => {
    let resolveFinish!: (text: string) => void
    const { model, deps } = setup({
      finishDictation: () =>
        new Promise<string>((resolve) => {
          resolveFinish = resolve
        }),
    })
    await model.start()
    const finishing = model.stop()
    await model.close()
    resolveFinish('Late transcript')
    await finishing
    expect(model.phase.value).toBe('idle')
    expect(model.resultText.value).toBe('')
    expect(deps.cancelDictation).toHaveBeenCalled()
    expect(deps.saveTranscript).not.toHaveBeenCalled()
  })

  it('starts with the configured source', () => {
    expect(configuredListenSource(undefined)).toEqual({ kind: 'systemMix' })
    expect(configuredListenSource(' ')).toEqual({ kind: 'systemMix' })
    expect(configuredListenSource('Telegram.exe')).toEqual({
      kind: 'application',
      appId: 'Telegram.exe',
    })
    expect(
      isSameSource(
        { kind: 'application', appId: 'a' },
        { kind: 'application', appId: 'b' }
      )
    ).toBe(false)
  })

  it('records the source and turns the transcript into a result', async () => {
    const { model, deps } = setup()
    await model.start({ kind: 'systemMix' })
    expect(deps.startDictation).toHaveBeenCalledWith(
      expect.objectContaining({ source: { kind: 'systemMix' } })
    )
    expect(model.phase.value).toBe('recording')

    await model.stop()

    expect(model.phase.value).toBe('result')
    expect(model.resultText.value).toBe('Hello there')
    expect(deps.saveTranscript).toHaveBeenCalledWith('Hello there')
  })

  it('shows that nothing was heard instead of an empty result', async () => {
    const { model, deps } = setup({ finishDictation: vi.fn(async () => ' ') })
    await model.start()
    await model.stop()
    expect(model.phase.value).toBe('empty')
    expect(deps.saveTranscript).not.toHaveBeenCalled()

    await model.retry()
    expect(model.phase.value).toBe('recording')
    expect(deps.startDictation).toHaveBeenCalledTimes(2)
  })

  it('waits for the same application when it quits and clears the notice when it resumes', async () => {
    const { model, handlers } = setup()
    await model.start({ kind: 'application', appId: 'telegram-desktop' })
    expect(model.isWaiting.value).toBe(true)

    handlers().onWaiting?.(false)
    expect(model.isWaiting.value).toBe(false)

    handlers().onSourceLost?.({
      kind: 'application',
      appId: 'telegram-desktop',
    })
    expect(model.source.value).toEqual({
      kind: 'application',
      appId: 'telegram-desktop',
    })
    expect(model.isSourceLost.value).toBe(true)
    expect(model.isWaiting.value).toBe(true)
    handlers().onWaiting?.(false)
    expect(model.isSourceLost.value).toBe(false)
  })

  it('switches the source without losing the transcript', async () => {
    const { model, deps, handlers } = setup()
    await model.start({ kind: 'systemMix' })
    handlers().onText({ committed: 'First words', draft: '' })

    await model.selectSource({ kind: 'application', appId: 'firefox' })

    expect(deps.switchSource).toHaveBeenCalledWith({
      kind: 'application',
      appId: 'firefox',
    })
    expect(model.transcript.value.committed).toBe('First words')
    expect(model.source.value).toEqual({
      kind: 'application',
      appId: 'firefox',
    })
  })

  it('keeps a ready source status received before the switch response', async () => {
    const { model, deps, handlers } = setup()
    await model.start()
    vi.mocked(deps.switchSource).mockImplementationOnce(async () => {
      handlers().onWaiting?.(false)
    })
    await model.selectSource({ kind: 'application', appId: 'ready-app' })
    expect(model.source.value).toEqual({
      kind: 'application',
      appId: 'ready-app',
    })
    expect(model.isWaiting.value).toBe(false)
  })

  it('keeps the old source when a switch fails and clears the error on a later switch', async () => {
    const switchSource = vi
      .fn<ListenModelDependencies['switchSource']>()
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValueOnce(undefined)
    const { model } = setup({ switchSource })
    await model.start({ kind: 'systemMix' })
    await model.selectSource({ kind: 'application', appId: 'firefox' })
    expect(model.source.value).toEqual({ kind: 'systemMix' })
    expect(model.errorText.value).toContain('gone')

    await model.selectSource({ kind: 'application', appId: 'firefox' })
    expect(model.errorText.value).toBe('')
    expect(model.source.value).toEqual({
      kind: 'application',
      appId: 'firefox',
    })
  })

  it('stops by itself after a long silence, music included', async () => {
    const { model, deps, advance } = setup()
    await model.start()
    advance(SILENCE_TIMEOUT_MS)
    await Promise.resolve()
    expect(deps.onAutoStop).toHaveBeenCalledWith('silence')
    expect(deps.finishDictation).toHaveBeenCalled()
  })

  it('stops on the repeated hotkey, then closes on the next one', async () => {
    const { model, deps } = setup()
    await model.start()
    await model.repeatHotkey()
    expect(model.phase.value).toBe('result')
    expect(deps.onClose).not.toHaveBeenCalled()

    await model.repeatHotkey()
    expect(deps.onClose).toHaveBeenCalled()
    expect(model.phase.value).toBe('idle')
  })

  it('keeps what was heard when the session breaks', async () => {
    const { model, handlers } = setup({
      finishDictation: vi.fn(async () => {
        throw new Error('closed')
      }),
    })
    await model.start()
    handlers().onText({ committed: 'Partial', draft: '' })
    handlers().onError(new Error('provider failed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(model.phase.value).toBe('result')
    expect(model.resultText.value).toBe('Partial')
  })

  it('reports a failure with nothing heard', async () => {
    const { model, handlers } = setup()
    await model.start()
    handlers().onError(new Error('no device'))
    expect(model.phase.value).toBe('failed')
    expect(model.errorText.value).toContain('no device')
  })
  it('serializes source switches and ignores a late response after cancellation', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_, fail) => {
      reject = fail
    })
    const { model, deps } = setup({ switchSource: vi.fn(() => pending) })
    await model.start()
    const first = model.selectSource({ kind: 'application', appId: 'a' })
    await model.selectSource({ kind: 'application', appId: 'b' })
    expect(deps.switchSource).toHaveBeenCalledTimes(1)
    expect(model.source.value).toEqual({ kind: 'systemMix' })
    await model.cancel()
    reject(new Error('late error'))
    await first
    expect(model.phase.value).toBe('idle')
    expect(model.errorText.value).toBe('')
  })

  it('does not replace an already stopped result with a late start failure', async () => {
    let reject!: (error: Error) => void
    const { model } = setup({
      startDictation: () =>
        new Promise<void>((_, fail) => {
          reject = fail
        }),
    })
    const starting = model.start()
    await model.stop()
    reject(new Error('late setup failure'))
    await starting
    expect(model.phase.value).toBe('result')
    expect(model.resultText.value).toBe('Hello there')
  })
})

it('retries the last explicitly selected source', async () => {
  const { model } = setup({ finishDictation: async () => '' })
  try {
    await model.start()
    await model.selectSource({ kind: 'application', appId: 'player' })
    await model.stop()
    await model.retry()
    expect(model.source.value).toEqual({ kind: 'application', appId: 'player' })
  } finally {
    model.dispose()
  }
})
