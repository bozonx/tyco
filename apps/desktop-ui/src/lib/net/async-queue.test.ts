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

it('bounds bytes and reports overflow while retaining already received values', async () => {
  const overflow: Error[] = []
  const queue = createAsyncQueue<string>({
    maxBytes: 4,
    sizeOf: (value) => value.length,
    onOverflow: (error) => overflow.push(error),
  })
  expect(queue.push('one')).toBe(true)
  expect(queue.push('two')).toBe(false)
  expect(overflow).toHaveLength(1)
  const seen: string[] = []
  await expect(
    (async () => {
      for await (const value of queue.values) seen.push(value)
    })()
  ).rejects.toThrow('Receive queue limit')
  expect(seen).toEqual(['one'])
})

it('reclaims queue capacity after a consumer reads a value', async () => {
  const queue = createAsyncQueue<string>({ maxCount: 1 })
  queue.push('one')
  const iterator = queue.values[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toBe('one')
  expect(queue.push('two')).toBe(true)
  queue.end()
  expect((await iterator.next()).value).toBe('two')
  expect((await iterator.next()).done).toBe(true)
})

it('stops accepting values when the consumer leaves early', async () => {
  const queue = createAsyncQueue<number>()
  queue.push(1)
  queue.push(2)
  for await (const _value of queue.values) break
  expect(queue.push(3)).toBe(false)
  expect(await collect(queue.values)).toEqual([])
})
