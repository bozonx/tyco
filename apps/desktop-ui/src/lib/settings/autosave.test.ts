import { describe, expect, it, vi } from 'vitest'

import { createAutosave } from './autosave'

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
