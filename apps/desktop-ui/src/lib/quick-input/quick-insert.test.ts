import { describe, expect, it, vi } from 'vitest'
import { createQuickInsert } from './quick-insert'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const deps = {
    correct: vi.fn(async (_text: string) => 'Corrected text'),
    cancelCorrection: vi.fn(),
    saveOutput: vi.fn(async (_text: string) => {}),
    insert: vi.fn(async (_text: string) => {}),
    setPending: vi.fn(),
    clearPending: vi.fn(),
    reportError: vi.fn(),
  }
  return { deps, model: createQuickInsert(deps) }
}

describe('quick correction and insertion', () => {
  it('corrects even short text and inserts the result once', async () => {
    const { deps, model } = setup()
    await model.start('hi')
    expect(deps.correct).toHaveBeenCalledWith('hi')
    expect(deps.saveOutput).toHaveBeenCalledWith('Corrected text')
    expect(deps.insert).toHaveBeenCalledExactlyOnceWith('Corrected text')
    expect(deps.clearPending).toHaveBeenCalledOnce()
  })

  it('ignores empty input', async () => {
    const { deps, model } = setup()
    await model.start('  ')
    expect(deps.setPending).not.toHaveBeenCalled()
    expect(deps.correct).not.toHaveBeenCalled()
  })

  it('blocks duplicate submissions and late results after cancellation', async () => {
    const { deps, model } = setup()
    const correction = deferred<string>()
    deps.correct.mockReturnValue(correction.promise)
    const pending = model.start('Original')
    await model.start('Duplicate')
    model.cancel()
    correction.resolve('Late result')
    await pending
    expect(deps.correct).toHaveBeenCalledOnce()
    expect(deps.cancelCorrection).toHaveBeenCalledOnce()
    expect(deps.insert).not.toHaveBeenCalled()
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('checks cancellation after saving history', async () => {
    const { deps, model } = setup()
    const history = deferred<void>()
    deps.saveOutput.mockReturnValue(history.promise)
    const pending = model.start('Original')
    await vi.waitFor(() => expect(deps.saveOutput).toHaveBeenCalled())
    model.cancel()
    history.resolve()
    await pending
    expect(deps.insert).not.toHaveBeenCalled()
  })

  it('keeps a newer pending operation intact when an older one finishes', async () => {
    const { deps, model } = setup()
    const old = deferred<string>()
    const current = deferred<string>()
    deps.correct
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise)
    const first = model.start('First')
    model.cancel()
    const second = model.start('Second')
    deps.clearPending.mockClear()
    old.resolve('Stale')
    await first
    expect(deps.clearPending).not.toHaveBeenCalled()
    current.resolve('Current')
    await second
    expect(deps.insert).toHaveBeenCalledExactlyOnceWith('Current')
  })

  it('reports failures, never inserts a fallback, and permits retry', async () => {
    const { deps, model } = setup()
    deps.correct.mockRejectedValueOnce(new Error('Unavailable'))
    await model.start('Original')
    expect(deps.reportError).toHaveBeenCalledOnce()
    expect(deps.insert).not.toHaveBeenCalled()
    await model.start('Original')
    expect(deps.insert).toHaveBeenCalledOnce()
  })

  it('rejects empty corrections', async () => {
    const { deps, model } = setup()
    deps.correct.mockResolvedValue(' ')
    await model.start('Original')
    expect(deps.insert).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledOnce()
  })
})
