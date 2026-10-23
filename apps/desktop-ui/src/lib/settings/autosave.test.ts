import { describe, expect, it, vi } from 'vitest'

import {
  AUTOSAVE_DELAY_MS,
  createAutosave,
  createAutosaveGroup,
  createSaveTracker,
  summarizeAutosave,
} from './autosave'

describe('createAutosave', () => {
  it('saves once after the last change', async () => {
    vi.useFakeTimers()
    try {
      const save = vi.fn(async () => {})
      const autosave = createAutosave({ save, delayMs: 300 })

      autosave.schedule()
      await vi.advanceTimersByTimeAsync(200)
      autosave.schedule()
      expect(autosave.status.value).toBe('pending')
      await vi.advanceTimersByTimeAsync(299)
      expect(save).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      expect(save).toHaveBeenCalledOnce()
      expect(autosave.status.value).toBe('saved')
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits the shared delay by default', async () => {
    vi.useFakeTimers()
    try {
      const save = vi.fn(async () => {})
      const autosave = createAutosave({ save })

      autosave.schedule()
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1)
      expect(save).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(save).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves a waiting change at once on flush', async () => {
    const save = vi.fn(async () => {})
    const autosave = createAutosave({ save, delayMs: 10_000 })

    autosave.schedule()
    await autosave.flush()

    expect(save).toHaveBeenCalledOnce()
    await autosave.flush()
    expect(save).toHaveBeenCalledOnce()
  })

  it('saves a change made during a save after it', async () => {
    let release!: () => void
    const save = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve))
      )
      .mockResolvedValue()
    const autosave = createAutosave({ save, delayMs: 0 })

    autosave.schedule()
    const first = autosave.flush()
    autosave.schedule()
    const second = autosave.flush()
    await Promise.resolve()
    release()
    await Promise.all([first, second])

    expect(save).toHaveBeenCalledTimes(2)
    expect(autosave.status.value).toBe('saved')
  })

  it('reports a failed save', async () => {
    const autosave = createAutosave({
      save: async () => {
        throw new Error('disk full')
      },
      delayMs: 0,
    })

    autosave.schedule()
    await autosave.flush()

    expect(autosave.status.value).toBe('error')
    expect(autosave.error.value).toBe('disk full')
  })

  it('retains a failed write for an explicit retry without looping', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined)
    const autosave = createAutosave({ save, delayMs: 10000 })
    autosave.schedule()
    expect(await autosave.flush()).toBe(false)
    expect(save).toHaveBeenCalledOnce()
    expect(await autosave.flush()).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(autosave.status.value).toBe('saved')
    expect(autosave.error.value).toBe('')
  })

  it('saves newer edits after an in-flight write fails', async () => {
    vi.useFakeTimers()
    try {
      let rejectSave!: (error: Error) => void
      const save = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectSave = reject
            })
        )
        .mockResolvedValue(undefined)
      const autosave = createAutosave({ save, delayMs: 100 })
      autosave.schedule()
      const pending = autosave.flush()
      autosave.schedule()
      await vi.advanceTimersByTimeAsync(100)
      rejectSave(new Error('temporary failure'))
      expect(await pending).toBe(true)
      expect(save).toHaveBeenCalledTimes(2)
      expect(autosave.status.value).toBe('saved')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not resurrect a failed write after cancellation', async () => {
    let rejectSave!: (error: Error) => void
    const save = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject
        })
    )
    const autosave = createAutosave({ save, delayMs: 10000 })
    autosave.schedule()
    const pending = autosave.flush()
    await Promise.resolve()
    autosave.cancel()
    rejectSave(new Error('disk full'))
    await pending
    await autosave.flush()
    expect(save).toHaveBeenCalledOnce()
    expect(autosave.status.value).toBe('idle')
  })

  it('forgets a cancelled change', async () => {
    const save = vi.fn(async () => {})
    const autosave = createAutosave({ save, delayMs: 10_000 })

    autosave.schedule()
    autosave.cancel()
    await autosave.flush()

    expect(save).not.toHaveBeenCalled()
    expect(autosave.status.value).toBe('idle')
  })
})

describe('autosave summary', () => {
  it('shows the worst state of the parts', () => {
    expect(summarizeAutosave(['saved', 'error', 'saving'])).toBe('error')
    expect(summarizeAutosave(['saved', 'pending'])).toBe('saving')
    expect(summarizeAutosave(['idle', 'saved'])).toBe('saved')
    expect(summarizeAutosave(['idle'])).toBe('')
  })
})

describe('save tracker', () => {
  it('shows saving until every save ends, then keeps a failure', async () => {
    const tracker = createSaveTracker({ resave: async () => {} })
    let failFirst!: (error: Error) => void
    const first = tracker.track(
      new Promise((_, reject) => {
        failFirst = reject
      })
    )
    const second = tracker.track(Promise.resolve())
    expect(tracker.status.value).toBe('saving')
    expect(await second).toBe(true)
    expect(tracker.status.value).toBe('saving')

    failFirst(new Error('disk full'))
    expect(await first).toBe(false)
    expect(tracker.status.value).toBe('error')
    expect(tracker.error.value).toBe('disk full')

    // a later save does not hide the failed one
    await tracker.track(Promise.resolve())
    expect(tracker.status.value).toBe('error')
  })

  it('stores the current value again on flush after a failure', async () => {
    const resave = vi
      .fn()
      .mockRejectedValueOnce(new Error('still full'))
      .mockResolvedValue(undefined)
    const tracker = createSaveTracker({ resave })
    await tracker.track(Promise.reject(new Error('disk full')))

    expect(await tracker.flush()).toBe(false)
    expect(tracker.error.value).toBe('still full')
    expect(await tracker.flush()).toBe(true)
    expect(resave).toHaveBeenCalledTimes(2)
    expect(tracker.status.value).toBe('saved')
    expect(tracker.error.value).toBe('')

    expect(await tracker.flush()).toBe(true)
    expect(resave).toHaveBeenCalledTimes(2)
  })

  it('forgets a failure on cancel', async () => {
    const resave = vi.fn(async () => {})
    const tracker = createSaveTracker({ resave })
    await tracker.track(Promise.reject(new Error('disk full')))

    tracker.cancel()

    expect(tracker.status.value).toBe('idle')
    expect(await tracker.flush()).toBe(true)
    expect(resave).not.toHaveBeenCalled()
  })
})

describe('autosave group', () => {
  it('reports every failure with a retry of the waiting changes', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined)
    const autosave = createAutosave({ save, delayMs: 10_000 })
    const reportError = vi.fn()
    const group = createAutosaveGroup({ parts: [autosave], reportError })

    autosave.schedule()
    expect(await group.flush()).toBe(false)
    expect(group.status.value).toBe('error')
    expect(reportError).toHaveBeenCalledWith('disk full', expect.any(Function))

    const [, retry] = reportError.mock.calls[0] as [string, () => void]
    retry()
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(2))

    retry()
    await vi.waitFor(() => expect(group.status.value).toBe('saved'))
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('saves and forgets its parts together', async () => {
    const first = createAutosave({ save: async () => {}, delayMs: 10_000 })
    const secondSave = vi.fn(async () => {})
    const second = createAutosave({ save: secondSave, delayMs: 10_000 })
    const group = createAutosaveGroup({
      parts: [first, second],
      reportError: vi.fn(),
    })

    first.schedule()
    second.schedule()
    expect(group.status.value).toBe('saving')
    expect(await group.flush()).toBe(true)
    expect(group.status.value).toBe('saved')

    second.schedule()
    group.cancel()
    await group.flush()
    expect(secondSave).toHaveBeenCalledOnce()
    expect(group.status.value).toBe('')
  })
})
