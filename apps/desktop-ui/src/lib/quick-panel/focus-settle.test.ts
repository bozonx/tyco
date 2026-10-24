import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFocusSettle } from './focus-settle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('focus settling', () => {
  it('waits 150 milliseconds by default and replaces pending work', () => {
    const settle = createFocusSettle({})
    const first = vi.fn()
    const second = vi.fn()
    settle.schedule(first)
    vi.advanceTimersByTime(100)
    settle.schedule(second)
    vi.advanceTimersByTime(149)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(second).toHaveBeenCalledOnce()
  })

  it('invalidates asynchronous work on new events or cancellation', () => {
    const settle = createFocusSettle({ settleMs: 10 })
    let isCurrent!: () => boolean
    settle.schedule((current) => {
      isCurrent = current
    })
    vi.advanceTimersByTime(10)
    expect(isCurrent()).toBe(true)
    settle.schedule(vi.fn())
    expect(isCurrent()).toBe(false)
    const current = settle.cancel()
    expect(current()).toBe(true)
    settle.cancel()
    expect(current()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses injected timers and cancels the pending callback', () => {
    const clearTimer = vi.fn()
    const setTimer = vi.fn(() => 'timer')
    const settle = createFocusSettle({ setTimer, clearTimer, settleMs: 75 })
    settle.schedule(vi.fn())
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 75)
    settle.cancel()
    expect(clearTimer).toHaveBeenCalledExactlyOnceWith('timer')
  })
})
