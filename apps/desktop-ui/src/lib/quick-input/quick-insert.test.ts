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
    openStep: vi.fn(),
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

  it('uses custom correct function when provided', async () => {
    const { deps, model } = setup()
    const custom = vi.fn(async (t: string) => `Custom: ${t}`)
    await model.start('test', custom)
    expect(custom).toHaveBeenCalledWith('test')
    expect(deps.correct).not.toHaveBeenCalled()
    expect(deps.insert).toHaveBeenCalledWith('Custom: test')
  })

  it('supports insertDirect without calling correction', async () => {
    const { deps, model } = setup()
    await model.insertDirect('Direct text')
    expect(deps.correct).not.toHaveBeenCalled()
    expect(deps.saveOutput).toHaveBeenCalledWith('Direct text')
    expect(deps.insert).toHaveBeenCalledWith('Direct text')
  })

  it('opens the actions step with corrected text and diff on next', async () => {
    const { deps, model } = setup()
    const custom = vi.fn(async (_t: string) => 'Fixed live text')
    await model.next('Raw live text', custom)
    expect(custom).toHaveBeenCalledWith('Raw live text')
    expect(deps.clearPending).toHaveBeenCalledOnce()
    expect(deps.openStep).toHaveBeenCalledWith({
      text: 'Fixed live text',
      oldText: 'Raw live text',
      isCorrectionUnchanged: false,
    })
    expect(deps.insert).not.toHaveBeenCalled()
  })

  it('marks isCorrectionUnchanged when next correction equals input', async () => {
    const { deps, model } = setup()
    const custom = vi.fn(async (t: string) => t)
    await model.next('Clean text', custom)
    expect(deps.openStep).toHaveBeenCalledWith({
      text: 'Clean text',
      oldText: '',
      isCorrectionUnchanged: true,
    })
  })

  it('does not open the actions step if next is cancelled while waiting', async () => {
    const { deps, model } = setup()
    const correction = deferred<string>()
    const pending = model.next('Raw text', () => correction.promise)
    model.cancel()
    correction.resolve('Late result')
    await pending
    expect(deps.cancelCorrection).toHaveBeenCalledOnce()
    expect(deps.openStep).not.toHaveBeenCalled()
  })

  it('opens the actions step with the typed text when next correction fails', async () => {
    const { deps, model } = setup()
    const failure = new Error('Offline')
    await model.next('Raw text', async () => {
      throw failure
    })
    expect(deps.reportError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(deps.clearPending).toHaveBeenCalledOnce()
    expect(deps.openStep).toHaveBeenCalledExactlyOnceWith({
      text: 'Raw text',
      oldText: '',
      isCorrectionUnchanged: false,
    })
  })

  it('does not open the fallback step when next is cancelled before it fails', async () => {
    const { deps, model } = setup()
    let fail: ((error: unknown) => void) | undefined
    const pending = model.next(
      'Raw text',
      () => new Promise<string>((_resolve, reject) => (fail = reject))
    )
    await vi.waitFor(() => expect(fail).toBeDefined())
    model.cancel()
    fail!(new Error('Aborted'))
    await pending
    expect(deps.reportError).not.toHaveBeenCalled()
    expect(deps.openStep).not.toHaveBeenCalled()
  })
})

describe('quick insertion history', () => {
  function setupWithHistory() {
    const { deps } = setup()
    const historyDeps = {
      ...deps,
      saveSource: vi.fn(async (_text: string) => 'source-1' as string | null),
      saveSourceResult: vi.fn(
        async (_id: string | null, _result: string) => {}
      ),
      reportHistoryError: vi.fn(),
    }
    return { deps: historyDeps, model: createQuickInsert(historyDeps) }
  }

  it('saves the typed text before the correction is requested', async () => {
    const { deps, model } = setupWithHistory()
    deps.correct.mockImplementationOnce(async () => {
      expect(deps.saveSource).toHaveBeenCalledWith('Typed text')
      return 'Corrected text'
    })
    await model.start('Typed text')
    expect(deps.saveSourceResult).toHaveBeenCalledWith(
      'source-1',
      'Corrected text'
    )
    expect(deps.insert).toHaveBeenCalledWith('Corrected text')
  })

  it('keeps the typed text in the history when the correction fails', async () => {
    const { deps, model } = setupWithHistory()
    deps.correct.mockRejectedValueOnce(new Error('Offline'))
    await model.start('Typed text')
    expect(deps.saveSource).toHaveBeenCalledWith('Typed text')
    expect(deps.saveSourceResult).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledOnce()
  })

  it('does not record an unchanged correction as a result', async () => {
    const { deps, model } = setupWithHistory()
    deps.correct.mockResolvedValueOnce('Clean text')
    await model.start('Clean text')
    expect(deps.saveSourceResult).not.toHaveBeenCalled()
    expect(deps.insert).toHaveBeenCalledWith('Clean text')
  })

  it('goes on with the submission when the history cannot be written', async () => {
    const { deps, model } = setupWithHistory()
    const failure = new Error('Disk full')
    deps.saveSource.mockRejectedValueOnce(failure)
    await model.start('Typed text')
    expect(deps.reportHistoryError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(deps.reportError).not.toHaveBeenCalled()
    expect(deps.saveSourceResult).toHaveBeenCalledWith(null, 'Corrected text')
    expect(deps.insert).toHaveBeenCalledWith('Corrected text')
  })

  it('saves the typed text before next opens the actions step', async () => {
    const { deps, model } = setupWithHistory()
    await model.next('Typed text', async () => {
      throw new Error('Offline')
    })
    expect(deps.saveSource).toHaveBeenCalledWith('Typed text')
    expect(deps.openStep).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Typed text' })
    )
  })
})

describe('quick insertion disposal', () => {
  it('blocks insertion even when disposal happens during a history write', async () => {
    const { deps, model } = setup()
    const history = deferred<void>()
    deps.saveOutput.mockReturnValue(history.promise)
    const pending = model.start('Original')
    await vi.waitFor(() => expect(deps.saveOutput).toHaveBeenCalledOnce())
    model.dispose()
    model.dispose()
    history.resolve()
    await pending
    await model.start('Another')
    expect(deps.cancelCorrection).toHaveBeenCalledOnce()
    expect(deps.correct).toHaveBeenCalledOnce()
    expect(deps.insert).not.toHaveBeenCalled()
    expect(deps.reportError).not.toHaveBeenCalled()
  })
})
