import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSingleTimer } from './single-timer'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('single timer', () => {
  it('runs once after the delay and is no longer pending then', () => {
    const timer = createSingleTimer()
    const run = vi.fn()
    timer.start(run, 100)
    expect(timer.isPending()).toBe(true)
    vi.advanceTimersByTime(99)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledOnce()
    expect(timer.isPending()).toBe(false)
  })

  it('replaces a pending run when started again', () => {
    const timer = createSingleTimer()
    const first = vi.fn()
    const second = vi.fn()
    timer.start(first, 100)
    timer.start(second, 100)
    vi.advanceTimersByTime(100)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('drops a pending run on stop', () => {
    const timer = createSingleTimer()
    const run = vi.fn()
    timer.start(run, 100)
    timer.stop()
    vi.advanceTimersByTime(100)
    expect(run).not.toHaveBeenCalled()
    expect(timer.isPending()).toBe(false)
  })

  it('uses the timer functions it is given', () => {
    const setTimer = vi.fn(() => 'timer')
    const clearTimer = vi.fn()
    const timer = createSingleTimer({ setTimer, clearTimer })
    timer.start(() => {}, 75)
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 75)
    timer.stop()
    expect(clearTimer).toHaveBeenCalledExactlyOnceWith('timer')
    timer.stop()
    expect(clearTimer).toHaveBeenCalledOnce()
  })
})
