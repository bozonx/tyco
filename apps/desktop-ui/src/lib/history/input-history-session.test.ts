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
  it('saves changing input every five seconds under the same identity', async () => {
    const { save, session } = setup()
    session.update('First')
    await vi.advanceTimersByTimeAsync(4999)
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
    await vi.advanceTimersByTimeAsync(5000)
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
    await vi.advanceTimersByTimeAsync(5000)
    expect(reportError).toHaveBeenCalledOnce()
    await session.flush()
    expect(save).toHaveBeenCalledTimes(2)
    session.dispose()
  })
})

it('retries an ended record on flush after storage recovers', async () => {
  const { save, session } = setup()
  save.mockRejectedValueOnce(new Error('Temporary failure'))
  session.update('Cancelled input')
  session.end()
  // Observe the failed attempt without starting another one.
  await vi.advanceTimersByTimeAsync(0)
  expect(save).toHaveBeenCalledOnce()
  await session.flush()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: 'Cancelled input', kind: 'draft' })
  )
  session.dispose()
})

it('retries a failed source promotion with its original identity and operation', async () => {
  const { save, session } = setup()
  session.update('Partial speech')
  await session.flush()
  save.mockRejectedValueOnce(new Error('Temporary failure'))
  await expect(
    session.complete('Final speech', 'source', 'voiceCorrection')
  ).rejects.toThrow('Temporary failure')
  await session.flush()
  expect(save).toHaveBeenLastCalledWith({
    id: 'input-id',
    text: 'Final speech',
    kind: 'source',
    operation: 'voiceCorrection',
  })
  await vi.advanceTimersByTimeAsync(30_000)
  expect(save).toHaveBeenCalledTimes(3)
  session.dispose()
})

it('keeps failed cancelled input while saving a new session', async () => {
  const { save, session } = setup()
  save.mockRejectedValueOnce(new Error('Temporary failure'))
  session.update('First input')
  session.end()
  await vi.advanceTimersByTimeAsync(0)
  session.update('Second input')
  await session.flush()
  expect(save.mock.calls.map(([entry]) => entry.text)).toEqual([
    'First input',
    'First input',
    'Second input',
  ])
  expect(save.mock.calls[2]?.[0].id).toBeUndefined()
  session.dispose()
})

it('retries disposed input with bounded backoff and stops after success', async () => {
  const { save, session } = setup()
  save
    .mockRejectedValueOnce(new Error('Temporary failure'))
    .mockRejectedValueOnce(new Error('Still unavailable'))
  session.update('Keep after unmount')
  session.dispose()
  await vi.advanceTimersByTimeAsync(0)
  expect(save).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1999)
  expect(save).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(save).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
})

it('returns the submitted source identity when an older input also needs recovery', async () => {
  const { save, session } = setup()
  save.mockRejectedValueOnce(new Error('Temporary failure'))
  session.update('Old cancelled input')
  session.end()
  await vi.advanceTimersByTimeAsync(0)
  save.mockResolvedValueOnce('old-id').mockResolvedValueOnce('new-source-id')
  session.update('New input')
  await expect(
    session.complete('New input', 'source', 'correction')
  ).resolves.toBe('new-source-id')
  await expect(session.flush()).resolves.toBe('new-source-id')
  session.dispose()
})
