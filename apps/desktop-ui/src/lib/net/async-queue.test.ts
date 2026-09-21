import { describe, expect, it } from 'vitest'

import { createAsyncQueue } from './async-queue'

async function collect<T>(values: AsyncIterable<T>) {
  const result: T[] = []
  for await (const value of values) result.push(value)
  return result
}

describe('async-queue', () => {
  it('delivers values pushed before and while reading', async () => {
    const queue = createAsyncQueue<number>()
    queue.push(1)
    const reading = collect(queue.values)

    queue.push(2)
    await Promise.resolve()
    queue.push(3)
    queue.end()

    expect(await reading).toEqual([1, 2, 3])
  })

  it('delivers queued values before a failure', async () => {
    const queue = createAsyncQueue<string>()
    queue.push('a')
    queue.fail(new Error('boom'))
    queue.push('ignored')

    const seen: string[] = []
    await expect(
      (async () => {
        for await (const value of queue.values) seen.push(value)
      })()
    ).rejects.toThrow('boom')
    expect(seen).toEqual(['a'])
  })

  it('ignores a failure after a normal end', async () => {
    const queue = createAsyncQueue<string>()
    queue.end()
    queue.fail(new Error('late'))

    expect(await collect(queue.values)).toEqual([])
  })
})
