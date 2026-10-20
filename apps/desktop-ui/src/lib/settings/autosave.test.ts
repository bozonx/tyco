import { describe, expect, it, vi } from 'vitest'

import { createAutosave, summarizeAutosave } from './autosave'

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
