import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runWithinCommandLimit } from './command-run-limit'

describe('runWithinCommandLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the result of a run that ends in time', async () => {
    await expect(
      runWithinCommandLimit(10, undefined, async () => 'done')
    ).resolves.toEqual({ isTimedOut: false, value: 'done' })
  })

  it('stops a run at the limit, even one that ignores the abort', async () => {
    let taskSignal: AbortSignal | undefined
    const run = runWithinCommandLimit(2, undefined, (signal) => {
      taskSignal = signal
      return new Promise<string>(() => {})
    })
    await vi.advanceTimersByTimeAsync(1999)
    expect(taskSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(run).resolves.toEqual({ isTimedOut: true, seconds: 2 })
    expect(taskSignal?.aborted).toBe(true)
  })

  it('does not limit a run when the limit is 0', async () => {
    let resolveTask!: (value: string) => void
    const run = runWithinCommandLimit(
      0,
      undefined,
      () =>
        new Promise<string>((resolve) => {
          resolveTask = resolve
        })
    )
    await vi.advanceTimersByTimeAsync(24 * 3600 * 1000)
    resolveTask('late')
    await expect(run).resolves.toEqual({ isTimedOut: false, value: 'late' })
  })

  it('uses the default limit for a missing setting', async () => {
    const run = runWithinCommandLimit(
      undefined,
      undefined,
      () => new Promise<string>(() => {})
    )
    await vi.advanceTimersByTimeAsync(300 * 1000)
    await expect(run).resolves.toEqual({ isTimedOut: true, seconds: 300 })
  })

  it('passes the caller cancellation on to the run', async () => {
    const caller = new AbortController()
    let taskSignal: AbortSignal | undefined
    const run = runWithinCommandLimit(10, caller.signal, async (signal) => {
      taskSignal = signal
      await new Promise((resolve) =>
        signal.addEventListener('abort', resolve, { once: true })
      )
      return 'cancelled'
    })
    caller.abort()
    await expect(run).resolves.toEqual({
      isTimedOut: false,
      value: 'cancelled',
    })
    expect(taskSignal?.aborted).toBe(true)
  })
})
