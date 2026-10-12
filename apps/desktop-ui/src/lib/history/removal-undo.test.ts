import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRemovalUndo } from './removal-undo'

const item = (id: string) => ({ id })
function fixture() {
  const deps = {
    remove: vi.fn(async (id: string) => item(id)),
    restore: vi.fn(async (_item: { id: string }): Promise<void> => undefined),
    release: vi.fn(async (_item: { id: string }): Promise<void> => undefined),
    clear: vi.fn(async () => undefined),
    reportError: vi.fn(),
    timeoutMs: 100,
  }
  return { deps, model: createRemovalUndo(deps) }
}
afterEach(() => vi.useRealTimers())

describe('removal undo', () => {
  it('retains ownership and allows retry after a failed restore', async () => {
    vi.useFakeTimers()
    const { deps, model } = fixture()
    await model.remove('first')
    deps.restore.mockRejectedValueOnce(new Error('Unavailable'))
    await model.undo()
    expect(model.removed.value).toEqual(item('first'))
    expect(deps.release).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledOnce()
    await model.undo()
    expect(model.removed.value).toBeNull()
    expect(deps.release).toHaveBeenCalledWith(item('first'))
    await model.dispose()
  })

  it('serializes deletions and gives the latest item its own timeout', async () => {
    vi.useFakeTimers()
    const { deps, model } = fixture()
    let finish!: (value: { id: string }) => void
    deps.remove.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const first = model.remove('first')
    const second = model.remove('second')
    await Promise.resolve()
    expect(deps.remove).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    finish(item('first'))
    await Promise.all([first, second])
    expect(model.removed.value).toEqual(item('second'))
    expect(deps.release).toHaveBeenCalledExactlyOnceWith(item('first'))
    await vi.advanceTimersByTimeAsync(99)
    expect(model.removed.value).toEqual(item('second'))
    await vi.advanceTimersByTimeAsync(1)
    expect(model.removed.value).toBeNull()
    expect(deps.release).toHaveBeenLastCalledWith(item('second'))
    await model.dispose()
  })

  it('keeps the previous undo if a later removal or clear fails', async () => {
    const { deps, model } = fixture()
    await model.remove('first')
    deps.remove.mockRejectedValueOnce(new Error('Unavailable'))
    await model.remove('second')
    deps.clear.mockRejectedValueOnce(new Error('Unavailable'))
    await model.clear()
    expect(model.removed.value).toEqual(item('first'))
    expect(deps.release).not.toHaveBeenCalled()
    await model.dispose()
  })

  it('releases a deletion completing after disposal without starting a timer', async () => {
    vi.useFakeTimers()
    const { deps, model } = fixture()
    let finish!: (value: { id: string }) => void
    deps.remove.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const removal = model.remove('first')
    await Promise.resolve()
    const disposal = model.dispose()
    finish(item('first'))
    await Promise.all([removal, disposal])
    expect(model.removed.value).toBeNull()
    expect(deps.release).toHaveBeenCalledExactlyOnceWith(item('first'))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds images until an in-flight restore finishes even after disposal', async () => {
    const { deps, model } = fixture()
    await model.remove('first')
    let finish!: () => void
    deps.restore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const restoring = model.undo()
    await Promise.resolve()
    const disposal = model.dispose()
    expect(deps.release).not.toHaveBeenCalled()
    finish()
    await Promise.all([restoring, disposal])
    expect(deps.release).toHaveBeenCalledExactlyOnceWith(item('first'))
  })
})
