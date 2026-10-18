import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCopyValue } from './copy-value'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function setup(writeText = vi.fn().mockResolvedValue(undefined)) {
  const reportFailure = vi.fn()
  const model = createCopyValue({ writeText, reportFailure, feedbackMs: 100 })
  return { model, writeText, reportFailure }
}

describe('copy value', () => {
  it('shows which value was copied for a moment', async () => {
    const { model, writeText } = setup()
    expect(await model.copy('/tmp/a', 'config')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('/tmp/a')
    expect(model.isCopied('config')).toBe(true)
    expect(model.isCopied('data')).toBe(false)

    await model.copy('/tmp/b', 'data')
    expect(model.isCopied('config')).toBe(false)
    expect(model.isCopied('data')).toBe(true)

    vi.advanceTimersByTime(100)
    expect(model.copiedKey.value).toBeNull()
  })

  it('reports a refused clipboard and shows nothing as copied', async () => {
    const { model, reportFailure } = setup(
      vi.fn().mockRejectedValue(new Error('denied'))
    )
    expect(await model.copy('id')).toBe(false)
    expect(reportFailure).toHaveBeenCalledOnce()
    expect(model.isCopied()).toBe(false)
  })

  it('forgets the copied value when disposed', async () => {
    const { model } = setup()
    await model.copy('id')
    model.dispose()
    expect(model.isCopied()).toBe(false)
    vi.advanceTimersByTime(100)
    expect(model.copiedKey.value).toBeNull()
  })
})
