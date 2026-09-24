import { describe, expect, it, vi } from 'vitest'

import { createVoiceSession } from './voice-session'

describe('createVoiceSession', () => {
  it('aborts the previous session and fires the recording limit once', () => {
    vi.useFakeTimers()
    const onLimit = vi.fn()
    const session = createVoiceSession({ maxRecordingMs: 1_000, onLimit })

    const first = session.begin()
    const second = session.begin()
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)

    vi.advanceTimersByTime(1_000)
    expect(onLimit).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1_000)
    expect(onLimit).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('cancels both the request and deadline when disposed', () => {
    vi.useFakeTimers()
    const onLimit = vi.fn()
    const session = createVoiceSession({ maxRecordingMs: 1_000, onLimit })
    const signal = session.begin()

    session.dispose()
    vi.advanceTimersByTime(1_000)

    expect(signal.aborted).toBe(true)
    expect(onLimit).not.toHaveBeenCalled()
    expect(session.signal).toBeUndefined()
    vi.useRealTimers()
  })
})
