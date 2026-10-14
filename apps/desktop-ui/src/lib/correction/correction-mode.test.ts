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

  it('corrects identical text again in a new activation', async () => {
    const startCorrection = vi.fn().mockResolvedValue(undefined)
    const model = createCorrectionMode({ startCorrection, setPending: vi.fn() })
    await model.consume('selected', 1)
    await model.consume('selected', 2)
    expect(startCorrection).toHaveBeenCalledTimes(2)
  })

  it('processes the latest capture received while isCorrecting', async () => {
    let finish!: () => void
    const startCorrection = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(undefined)
    const model = createCorrectionMode({ startCorrection, setPending: vi.fn() })
    const first = model.consume('first')
    await model.consume('second')
    await model.consume('latest')
    finish()
    await first
    expect(startCorrection.mock.calls.map(([text]) => text)).toEqual([
      'first',
      'latest',
    ])
  })

  it('ignores completion of a correction belonging to an older activation', async () => {
    const finish: (() => void)[] = []
    const startCorrection = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish.push(resolve)
        })
    )
    const setPending = vi.fn()
    const model = createCorrectionMode({ startCorrection, setPending })
    const first = model.consume('same', 1)
    const second = model.consume('same', 2)
    finish[0]!()
    await first
    expect(setPending.mock.calls).toEqual([[true], [true]])
    finish[1]!()
    await second
    expect(setPending).toHaveBeenLastCalledWith(false)
  })
})
