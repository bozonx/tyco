import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInputHistorySession } from './input-history-session'

function setup() {
  vi.useFakeTimers()
  const save = vi.fn().mockResolvedValue('input-id')
  const reportError = vi.fn()
  return {
    save,
    reportError,
    session: createInputHistorySession({ save, reportError }),
  }
}
afterEach(() => vi.useRealTimers())

describe('input history checkpoints', () => {
  it('saves changing input every ten seconds under the same identity', async () => {
    const { save, session } = setup()
    session.update('First')
    await vi.advanceTimersByTimeAsync(9999)
    expect(save).not.toHaveBeenCalled()
    session.update('First words')
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenLastCalledWith({
      id: undefined,
      text: 'First words',
      kind: 'draft',
      operation: undefined,
    })
    session.update('First words continued')
    await vi.advanceTimersByTimeAsync(10000)
    expect(save).toHaveBeenLastCalledWith({
      id: 'input-id',
      text: 'First words continued',
      kind: 'draft',
      operation: undefined,
    })
    await session.flush()
    expect(save).toHaveBeenCalledTimes(2)
    session.dispose()
  })
  it('flushes cancellation immediately and starts the next input independently', async () => {
    const { save, session } = setup()
    session.update('Cancelled words')
    session.end()
    await session.flush()
    expect(save).toHaveBeenCalledOnce()
    session.update('New input')
    await session.flush()
    expect(save).toHaveBeenLastCalledWith({
      id: undefined,
      text: 'New input',
      kind: 'draft',
      operation: undefined,
    })
    session.dispose()
  })
  it('waits for a checkpoint before promoting it to an AI source', async () => {
    const { save, session } = setup()
    let resolve!: (id: string) => void
    save.mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done
        })
    )
    session.update('Partial')
    const checkpoint = session.flush()
    await Promise.resolve()
    await Promise.resolve()
    const completed = session.complete(
      'Final words',
      'source',
      'voiceCorrection'
    )
    resolve('stable-id')
    await checkpoint
    await completed
    expect(save).toHaveBeenLastCalledWith({
      id: 'stable-id',
      text: 'Final words',
      kind: 'source',
      operation: 'voiceCorrection',
    })
    session.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retries failed writes and does not write empty inputs', async () => {
    const { save, reportError, session } = setup()
    session.update(' ')
    await session.flush()
    expect(save).not.toHaveBeenCalled()
    save.mockRejectedValueOnce(new Error('Disk full'))
    session.update('Recoverable')
    await vi.advanceTimersByTimeAsync(10000)
    expect(reportError).toHaveBeenCalledOnce()
    await session.flush()
    expect(save).toHaveBeenCalledTimes(2)
    session.dispose()
  })
})
