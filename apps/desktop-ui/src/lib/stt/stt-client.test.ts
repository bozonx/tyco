import type { SocketOpener, TranscriptPart } from '@bozonx/ai-kit'
import { describe, expect, it, vi } from 'vitest'

import { createAsyncQueue } from '../net/async-queue'
import { buildSttCatalog, createSttClient } from './stt-client'

const model = {
  id: 'deepgram-stt',
  provider: 'deepgram' as const,
  model: 'nova-3',
}

function results(text: string, isFinal: boolean, start = 0) {
  return JSON.stringify({
    type: 'Results',
    is_final: isFinal,
    start,
    duration: 1,
    channel: { alternatives: [{ transcript: text }] },
  })
}

/** A Deepgram stand-in: answers once the client sends `CloseStream` */
function fakeDeepgram(replies: string[]) {
  const opened: { url: string; headers?: Record<string, string> }[] = []
  const sent: (string | Uint8Array)[] = []
  const openSocket: SocketOpener = async (url, options) => {
    opened.push({ url, headers: options.headers })
    const messages = createAsyncQueue<string>()
    return {
      messages: messages.values,
      send: (data) => sent.push(data),
      close: (payload) => {
        if (payload) sent.push(payload)
        replies.forEach((reply) => messages.push(reply))
        messages.end()
      },
    }
  }
  return { openSocket, opened, sent }
}

async function* audio(...chunks: number[][]) {
  for (const chunk of chunks) yield { data: new Uint8Array(chunk) }
}

async function collect(parts: AsyncIterable<TranscriptPart>) {
  const result: TranscriptPart[] = []
  for await (const part of parts) result.push(part)
  return result
}

describe('buildSttCatalog', () => {
  it('maps the configured model to an unpriced live speech task', () => {
    const catalog = buildSttCatalog(model)

    expect(catalog.kindOf('transcription')).toBe('stt')
    expect(catalog.require('deepgram-stt')).toMatchObject({
      kind: 'stt',
      provider: 'deepgram',
      model: 'nova-3',
      sttCapabilities: { realtime: true },
    })
  })

  it('rejects an empty model name', () => {
    expect(() => buildSttCatalog({ ...model, model: ' ' })).toThrow(
      'model name is empty'
    )
  })
})

describe('createSttClient', () => {
  it('streams the audio and yields partial and final text', async () => {
    const deepgram = fakeDeepgram([
      results('hello', false),
      results('hello world', true),
    ])
    const client = createSttClient({
      transport: { fetch: vi.fn(), openSocket: deepgram.openSocket },
    })

    const parts = await collect(
      client.transcribeLive({
        model,
        audio: audio([1, 0], [2, 0]),
        sampleRate: 16_000,
        hasApiKey: true,
      })
    )

    expect(parts.filter((part) => part.type === 'partial')).toMatchObject([
      { text: 'hello' },
    ])
    expect(parts.filter((part) => part.type === 'final')).toMatchObject([
      { segment: { text: 'hello world' } },
    ])
    expect(parts.at(-1)).toMatchObject({ type: 'finish' })

    const [{ url, headers }] = deepgram.opened
    expect(headers?.authorization).toBe('Token tyco-secret:deepgram')
    expect(url).toContain('model=nova-3')
    expect(url).toContain('sample_rate=16000')
    expect(url).toContain('interim_results=true')
    expect(deepgram.sent).toEqual([
      new Uint8Array([1, 0]),
      new Uint8Array([2, 0]),
      JSON.stringify({ type: 'CloseStream' }),
    ])
  })

  it('follows any spoken language unless one is given', async () => {
    const deepgram = fakeDeepgram([])
    const client = createSttClient({
      transport: { fetch: vi.fn(), openSocket: deepgram.openSocket },
    })

    await collect(
      client.transcribeLive({
        model,
        audio: audio(),
        sampleRate: 16_000,
        hasApiKey: true,
      })
    )
    await collect(
      client.transcribeLive({
        model,
        audio: audio(),
        sampleRate: 16_000,
        language: 'ru',
        hasApiKey: true,
      })
    )

    expect(deepgram.opened[0].url).toContain('language=multi')
    expect(deepgram.opened[0].url).not.toContain('detect_language')
    expect(deepgram.opened[1].url).toContain('language=ru')
  })

  it('reports a failed audio source as an error part', async () => {
    const deepgram = fakeDeepgram([])
    const client = createSttClient({
      transport: { fetch: vi.fn(), openSocket: deepgram.openSocket },
    })
    async function* broken() {
      yield { data: new Uint8Array([1, 0]) }
      throw new Error('microphone unplugged')
    }

    const parts = await collect(
      client.transcribeLive({
        model,
        audio: broken(),
        sampleRate: 16_000,
        hasApiKey: true,
      })
    )

    expect(parts.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('microphone unplugged'),
    })
  })
})
