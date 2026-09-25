import { describe, expect, it, vi } from 'vitest'

import { createQuickCorrection, isCorrectionAborted } from './quick-correction'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const calls: {
    text: string
    signal: AbortSignal
    result: ReturnType<typeof deferred<string>>
  }[] = []
  const correct = vi.fn((text: string, signal: AbortSignal) => {
    const result = deferred<string>()
    calls.push({ text, signal, result })
    return result.promise
  })
  let timerCallback: (() => void) | null = null
  const model = createQuickCorrection({
    correct,
    setTimer: (callback) => {
      timerCallback = callback
      return 1
    },
    clearTimer: () => {
      timerCallback = null
    },
  })
  const fireTimer = () => {
    const callback = timerCallback
    timerCallback = null
    callback?.()
  }
  return { model, correct, calls, fireTimer, hasTimer: () => !!timerCallback }
}

describe('createQuickCorrection', () => {
  it('shares a running correction of the same text', async () => {
    const { model, correct, calls } = setup()

    const first = model.request('text')
    const second = model.request('text')
    calls[0].result.resolve('fixed')

    await expect(first).resolves.toBe('fixed')
    await expect(second).resolves.toBe('fixed')
    expect(correct).toHaveBeenCalledTimes(1)
  })

  it('reuses a finished correction without a new request', async () => {
    const { model, correct, calls } = setup()

    const first = model.request('text')
    calls[0].result.resolve('fixed')
    await first

    await expect(model.request('text')).resolves.toBe('fixed')
    expect(model.peek('text')).toBe('fixed')
    expect(model.peek('other')).toBeUndefined()
    expect(correct).toHaveBeenCalledTimes(1)
  })

  it('aborts the running correction when another text is requested', async () => {
    const { model, calls } = setup()

    const first = model.request('old')
    const second = model.request('new')

    expect(calls[0].signal.aborted).toBe(true)
    calls[0].result.resolve('partial')
    await expect(first).rejects.toSatisfy(isCorrectionAborted)

    calls[1].result.resolve('fixed new')
    await expect(second).resolves.toBe('fixed new')
    expect(model.peek('old')).toBeUndefined()
  })

  it('rejects an aborted run even when the request layer resolves', async () => {
    const { model, calls } = setup()

    const pending = model.request('text')
    model.cancel()
    calls[0].result.resolve('partial')

    await expect(pending).rejects.toSatisfy(isCorrectionAborted)
    expect(model.peek('text')).toBeUndefined()
  })

  it('passes real failures through and allows a retry', async () => {
    const { model, correct, calls } = setup()

    const pending = model.request('text')
    calls[0].result.reject(new Error('offline'))
    await expect(pending).rejects.toThrow('offline')

    void model.request('text')
    expect(correct).toHaveBeenCalledTimes(2)
  })

  it('corrects speculatively after a pause and drops stale work on edits', async () => {
    const { model, correct, calls, fireTimer, hasTimer } = setup()

    model.speculate('draft')
    expect(correct).not.toHaveBeenCalled()
    fireTimer()
    expect(calls[0].text).toBe('draft')

    model.speculate('draft more')
    expect(calls[0].signal.aborted).toBe(true)
    expect(hasTimer()).toBe(true)

    model.speculate(null)
    expect(hasTimer()).toBe(false)
  })

  it('lets the submit take over a speculative run', async () => {
    const { model, correct, calls, fireTimer } = setup()

    model.speculate('text')
    fireTimer()
    const submitted = model.request('text')
    calls[0].result.resolve('fixed')

    await expect(submitted).resolves.toBe('fixed')
    expect(correct).toHaveBeenCalledTimes(1)
  })
})
