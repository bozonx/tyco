import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createVoiceSession,
  type VoiceSessionDependencies,
} from './voice-session'

afterEach(() => vi.useRealTimers())

function setup(overrides: Partial<VoiceSessionDependencies> = {}) {
  const deps = {
    maxRecordingMs: 1_000,
    silenceTimeoutMs: 10_000,
    warningLeadMs: 200,
    onAutoStop: vi.fn(),
    onWarning: vi.fn(),
    ...overrides,
  }
  return { deps, session: createVoiceSession(deps) }
}

describe('createVoiceSession', () => {
  it('aborts the previous session and fires the recording limit once', () => {
    vi.useFakeTimers()
    const { deps, session } = setup()

    const first = session.begin()
    const second = session.begin()
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)

    vi.advanceTimersByTime(1_000)
    expect(deps.onAutoStop).toHaveBeenCalledExactlyOnceWith('limit')
    vi.advanceTimersByTime(1_000)
    expect(deps.onAutoStop).toHaveBeenCalledOnce()
  })

  it('stops on silence unless activity moves the deadline', () => {
    vi.useFakeTimers()
    const { deps, session } = setup({
      maxRecordingMs: 60_000,
      silenceTimeoutMs: 1_000,
    })
    session.begin()
    vi.advanceTimersByTime(900)
    session.markActivity()
    vi.advanceTimersByTime(900)
    expect(deps.onAutoStop).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(deps.onAutoStop).toHaveBeenCalledExactlyOnceWith('silence')
  })

  it('warns before the stop and clears the warning when it ends', () => {
    vi.useFakeTimers()
    const { deps, session } = setup()
    const startedAt = Date.now()
    session.begin()

    vi.advanceTimersByTime(799)
    expect(deps.onWarning).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(deps.onWarning).toHaveBeenLastCalledWith({
      reason: 'limit',
      deadlineMs: startedAt + 1_000,
    })

    // activity cannot push away the recording limit
    session.markActivity()
    expect(deps.onWarning).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(200)
    expect(deps.onWarning).toHaveBeenLastCalledWith(undefined)
  })

  it('cancels both the request and deadlines when disposed', () => {
    vi.useFakeTimers()
    const { deps, session } = setup()
    const signal = session.begin()

    session.dispose()
    vi.advanceTimersByTime(20_000)

    expect(signal.aborted).toBe(true)
    expect(deps.onAutoStop).not.toHaveBeenCalled()
    expect(session.signal).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
