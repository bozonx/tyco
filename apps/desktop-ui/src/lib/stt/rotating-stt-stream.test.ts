import { describe, expect, it, vi } from 'vitest'
import type { ProviderStreamRequest, SttStreamEvent } from '@bozonx/ai-kit/stt'
import { createAsyncQueue } from '../net/async-queue'
import { createRotatingSttStream } from './rotating-stt-stream'

async function* audio(...values: number[]) {
  for (const value of values) yield { data: new Uint8Array(20).fill(value) }
}
const request = (
  input: ProviderStreamRequest['audio']
): ProviderStreamRequest => ({
  modelId: 'test',
  options: {},
  sampleRate: 10,
  audio: input,
  signal: new AbortController().signal,
})
const collect = async (stream: AsyncIterable<SttStreamEvent>) => {
  const events: SttStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('rotating STT stream', () => {
  it('keeps one capture, drains each connection and offsets the next transcript', async () => {
    const chunks: number[][] = []
    const stream = await createRotatingSttStream(
      request(audio(1, 2, 3)),
      async (segment) => {
        const values: number[] = []
        chunks.push(values)
        return {
          async *[Symbol.asyncIterator]() {
            for await (const chunk of segment.audio) values.push(chunk.data[0])
            yield {
              type: 'final',
              segment: { text: String(values[0]), startMs: 0, endMs: 500 },
            } as const
          },
        }
      },
      1000
    )
    const events = await collect(stream)
    expect(chunks).toEqual([[1], [2], [3]])
    expect(events).toEqual(
      [0, 1000, 2000].map((offset, index) => ({
        type: 'final',
        segment: {
          text: String(index + 1),
          startMs: offset,
          endMs: offset + 500,
        },
      }))
    )
  })

  it('honors an early provider rotation and commits the previous draft', async () => {
    let connections = 0
    const values: number[] = []
    const stream = await createRotatingSttStream(
      request(audio(1, 2)),
      async (segment, rotate) => {
        const index = ++connections
        return {
          async *[Symbol.asyncIterator]() {
            for await (const chunk of segment.audio) {
              values.push(chunk.data[0])
              if (index === 1) rotate()
            }
            yield { type: 'partial', text: String(index), startMs: 0 } as const
          },
        }
      },
      10_000
    )
    const events = await collect(stream)
    expect(connections).toBe(2)
    expect(values).toEqual([1, 2])
    expect(events[1]).toEqual({
      type: 'final',
      segment: { text: '1', startMs: 0, endMs: 1000 },
    })
    expect(events.at(-1)).toMatchObject({
      type: 'partial',
      text: '2',
      startMs: 1000,
    })
  })

  it('rotates by wall time even when the source has sent less audio', async () => {
    vi.useFakeTimers()
    try {
      const input = createAsyncQueue<{ data: Uint8Array }>()
      const chunks: number[][] = []
      let gotFirst!: () => void
      const first = new Promise<void>((resolve) => {
        gotFirst = resolve
      })
      const stream = await createRotatingSttStream(
        request(input.values),
        async (segment) => {
          const values: number[] = []
          chunks.push(values)
          return {
            async *[Symbol.asyncIterator]() {
              for await (const chunk of segment.audio) {
                values.push(chunk.data[0])
                gotFirst()
              }
              yield {
                type: 'final',
                segment: { text: String(values[0]), startMs: 0, endMs: 100 },
              } as const
            },
          }
        },
        1000
      )
      const reading = collect(stream)
      input.push({ data: new Uint8Array([1, 0]) })
      await first
      await vi.advanceTimersByTimeAsync(1000)
      input.push({ data: new Uint8Array([2, 0]) })
      input.end()
      await reading
      expect(chunks).toEqual([[1], [2]])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reconnect when cancelled or when the provider fails', async () => {
    const controller = new AbortController()
    const open = vi.fn(
      async (_segment: ProviderStreamRequest, rotate: () => void) => ({
        async *[Symbol.asyncIterator]() {
          rotate()
          controller.abort()
          yield { type: 'language', language: 'en' } as const
        },
      })
    )
    await collect(
      await createRotatingSttStream(
        { ...request(audio(1, 2)), signal: controller.signal },
        open,
        1000
      )
    )
    expect(open).toHaveBeenCalledOnce()
    const failure = new Error('disconnected')
    await expect(
      createRotatingSttStream(
        request(audio(1)),
        async () => {
          throw failure
        },
        1000
      )
    ).rejects.toBe(failure)
  })
})
