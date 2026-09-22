import { describe, expect, it, vi } from 'vitest'

import { createCorrectionMode } from './correction-mode'

describe('correction mode', () => {
  it('starts once when captured text becomes available', async () => {
    const startCorrection = vi.fn().mockResolvedValue(undefined)
    const setPending = vi.fn()
    const model = createCorrectionMode({ startCorrection, setPending })

    await model.consume(null)
    await model.consume('selected text')
    await model.consume('selected text')

    expect(startCorrection).toHaveBeenCalledOnce()
    expect(startCorrection).toHaveBeenCalledWith('selected text')
    expect(setPending.mock.calls).toEqual([[true], [false]])
  })

  it('allows a new capture after the previous correction finishes', async () => {
    const startCorrection = vi.fn().mockResolvedValue(undefined)
    const model = createCorrectionMode({ startCorrection, setPending: vi.fn() })

    await model.consume('first')
    await model.consume(null)
    await model.consume('first')
    await model.consume('second')

    expect(startCorrection).toHaveBeenCalledTimes(3)
  })
})
