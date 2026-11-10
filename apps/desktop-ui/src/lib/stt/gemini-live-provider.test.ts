import { describe, expect, it, vi } from 'vitest'
import { createAsyncQueue } from '../net/async-queue'
import {
  createGeminiLiveProvider,
  parseGeminiLiveMessage,
  uint8ArrayToBase64,
} from './gemini-live-provider'

describe('gemini-live-provider', () => {
  it('finishes after the last turn without waiting for the socket to close', async () => {
    const messages = createAsyncQueue<string>()
    const audio = createAsyncQueue<{ data: Uint8Array }>()
    const close = vi.fn()
    let endSent!: () => void
    const ended = new Promise<void>((resolve) => {
      endSent = resolve
    })
    const provider = createGeminiLiveProvider()({
      apiKey: 'test-key',
      openSocket: async () => ({
        messages: messages.values,
        close,
        send: (raw) => {
          if (JSON.parse(raw as string).realtimeInput?.activityEnd) endSent()
        },
      }),
    })
    const events = await provider.transcribeStream!({
      modelId: 'gemini-3.5-transcribe-live',
      options: {},
      sampleRate: 16000,
      signal: new AbortController().signal,
      audio: audio.values,
    })
    const collected: unknown[] = []
    const reading = (async () => {
      for await (const event of events) {
        collected.push(event)
        // A completed turn while recording must not stop the microphone stream.
        if (event.type === 'final' && event.segment.text === 'First') {
          audio.push({ data: new Uint8Array([0, 16]) })
          audio.end()
        }
      }
    })()
    messages.push(JSON.stringify({ setupComplete: {} }))
    messages.push(
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'First' },
          turnComplete: true,
        },
      })
    )
    await ended
    messages.push(
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'Last' },
          turnComplete: true,
        },
      })
    )
    await reading
    expect(collected).toHaveLength(2)
    expect(close).toHaveBeenCalledOnce()
  })

  it('drains and finishes when server omits turnComplete after audio ends', async () => {
    vi.useFakeTimers()
    try {
      const messages = createAsyncQueue<string>()
      const audio = createAsyncQueue<{ data: Uint8Array }>()
      const close = vi.fn()
      let endSent!: () => void
      const ended = new Promise<void>((resolve) => {
        endSent = resolve
      })
      const provider = createGeminiLiveProvider()({
        apiKey: 'test-key',
        openSocket: async () => ({
          messages: messages.values,
          close,
          send: (raw) => {
            if (JSON.parse(raw as string).realtimeInput?.activityEnd) endSent()
          },
        }),
      })
      const events = await provider.transcribeStream!({
        modelId: 'gemini-3.5-transcribe-live',
        options: {},
        sampleRate: 16000,
        signal: new AbortController().signal,
        audio: audio.values,
      })
      const collected: unknown[] = []
      const reading = (async () => {
        for await (const event of events) {
          collected.push(event)
        }
      })()
      messages.push(JSON.stringify({ setupComplete: {} }))
      // Send speech chunk, then end audio
      audio.push({ data: new Uint8Array([0, 16]) })
      audio.end()
      await ended

      // Server sends transcription without turnComplete
      messages.push(
        JSON.stringify({
          serverContent: {
            inputTranscription: { text: 'Only text without turnComplete' },
          },
        })
      )
      // Advance timers by drain duration (1500ms)
      await vi.advanceTimersByTimeAsync(1500)
      await reading

      expect(collected).toHaveLength(1)
      expect(close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('finishes silent audio without sending empty activity turns or waiting for a reply', async () => {
    const messages = createAsyncQueue<string>()
    const sent: Record<string, unknown>[] = []
    const close = vi.fn()
    const provider = createGeminiLiveProvider()({
      apiKey: 'test-key',
      openSocket: async () => ({
        messages: messages.values,
        close,
        send: (raw) => {
          const frame = JSON.parse(raw as string)
          sent.push(frame)
          if (frame.setup) messages.push(JSON.stringify({ setupComplete: {} }))
        },
      }),
    })
    const events = await provider.transcribeStream!({
      modelId: 'gemini-3.5-transcribe-live',
      options: {},
      sampleRate: 16000,
      signal: new AbortController().signal,
      audio: {
        async *[Symbol.asyncIterator]() {
          yield { data: new Uint8Array(64000) }
        },
      },
    })
    const collected = []
    for await (const event of events) collected.push(event)
    expect(collected).toEqual([])
    expect(sent).toHaveLength(1)
    expect(close).toHaveBeenCalledOnce()
  })

  it('preserves both utterances and drains every outstanding final turn', async () => {
    const messages = createAsyncQueue<string>()
    const sent: Array<{ realtimeInput?: Record<string, unknown> }> = []
    let turnCount = 0
    const provider = createGeminiLiveProvider()({
      apiKey: 'test-key',
      openSocket: async () => ({
        messages: messages.values,
        close: vi.fn(),
        send: (raw) => {
          const frame = JSON.parse(raw as string)
          sent.push(frame)
          if (frame.setup) messages.push(JSON.stringify({ setupComplete: {} }))
          if (frame.realtimeInput?.activityEnd)
            messages.push(
              JSON.stringify({
                serverContent: {
                  inputTranscription: { text: `Utterance ${++turnCount}` },
                  turnComplete: true,
                },
              })
            )
        },
      }),
    })
    const events = await provider.transcribeStream!({
      modelId: 'gemini-3.5-transcribe-live',
      options: {},
      sampleRate: 16000,
      signal: new AbortController().signal,
      audio: {
        async *[Symbol.asyncIterator]() {
          yield { data: new Uint8Array([0, 16]) }
          yield { data: new Uint8Array(48000) }
          yield { data: new Uint8Array(48000) }
          yield { data: new Uint8Array([0, 16]) }
        },
      },
    })
    const texts = []
    for await (const event of events)
      if (event.type === 'final') texts.push(event.segment.text)
    expect(texts).toEqual(['Utterance 1', 'Utterance 2'])
    expect(
      sent.filter((frame) => frame.realtimeInput?.activityStart)
    ).toHaveLength(2)
    expect(
      sent.filter((frame) => frame.realtimeInput?.activityEnd)
    ).toHaveLength(2)
    expect(sent.some((frame) => frame.realtimeInput?.audioStreamEnd)).toBe(
      false
    )
    // Speech, its trailing silence, the bounded onset buffer, then speech.
    expect(
      sent.filter((frame) => frame.realtimeInput?.mediaChunks)
    ).toHaveLength(4)
  })

  it.each(['audio', 'send', 'setup', 'abort'] as const)(
    'reports %s failures even when the receive socket stays open',
    async (source) => {
      const messages = createAsyncQueue<string>()
      const controller = new AbortController()
      const close = vi.fn()
      const provider = createGeminiLiveProvider()({
        apiKey: 'test-key',
        openSocket: async () => ({
          messages: messages.values,
          close,
          send: (raw) => {
            const frame = JSON.parse(raw as string)
            if (
              (source === 'send' && frame.realtimeInput) ||
              (source === 'setup' && frame.setup)
            )
              throw new Error('Send failed')
          },
        }),
      })
      const events = await provider.transcribeStream!({
        modelId: 'gemini-3.5-transcribe-live',
        options: {},
        sampleRate: 16000,
        signal: controller.signal,
        audio: {
          async *[Symbol.asyncIterator]() {
            if (source === 'audio') throw new Error('Microphone failed')
            yield { data: new Uint8Array([1, 2]) }
          },
        },
      })
      const reading = (async () => {
        for await (const _ of events) {
          /* consume */
        }
      })()
      const assertion = expect(reading).rejects.toThrow(
        source === 'audio'
          ? 'Microphone failed'
          : source === 'abort'
            ? 'Aborted'
            : 'Send failed'
      )
      if (source === 'abort') controller.abort()
      else messages.push(JSON.stringify({ setupComplete: {} }))
      await assertion
      expect(close).toHaveBeenCalledOnce()
    }
  )

  it('drains an early GoAway and carries pending audio to the next connection', async () => {
    const audio = createAsyncQueue<{ data: Uint8Array }>()
    const queues: ReturnType<typeof createAsyncQueue<string>>[] = []
    const chunks: number[][] = []
    let firstSent!: () => void
    const sent = new Promise<void>((resolve) => {
      firstSent = resolve
    })
    let rotated!: () => void
    const rotationRead = new Promise<void>((resolve) => {
      rotated = resolve
    })
    const provider = createGeminiLiveProvider(undefined, {
      isContinuous: true,
    })({
      apiKey: 'test-key',
      openSocket: async () => {
        const index = chunks.length
        chunks.push([])
        const queue = createAsyncQueue<string>()
        queues.push(queue)
        queue.push(JSON.stringify({ setupComplete: {} }))
        return {
          messages: {
            async *[Symbol.asyncIterator]() {
              for await (const message of queue.values) {
                yield message
                if (JSON.parse(message).goAway) rotated()
              }
            },
          },
          close: () => queue.end(),
          send: (raw) => {
            const frame = JSON.parse(raw as string)
            const data = frame.realtimeInput?.mediaChunks?.[0]?.data
            if (data) {
              chunks[index].push(Buffer.from(data, 'base64')[0])
              if (index === 0) firstSent()
            }
            if (frame.realtimeInput?.activityEnd)
              queue.push(
                JSON.stringify({
                  serverContent: {
                    inputTranscription: { text: `Part ${index}` },
                    turnComplete: true,
                  },
                })
              )
          },
        }
      },
    })
    const events = await provider.transcribeStream!({
      modelId: 'gemini-3.5-transcribe-live',
      sampleRate: 10,
      options: {},
      signal: new AbortController().signal,
      audio: audio.values,
    })
    const texts: string[] = []
    const reading = (async () => {
      for await (const event of events)
        if (event.type === 'final') texts.push(event.segment.text)
    })()
    audio.push({ data: new Uint8Array(20).fill(1) })
    await sent
    queues[0].push(JSON.stringify({ goAway: { timeLeft: '60s' } }))
    await rotationRead
    audio.push({ data: new Uint8Array(20).fill(2) })
    audio.end()
    await reading
    expect(chunks).toEqual([[1], [2]])
    expect(texts).toEqual(['Part 0', 'Part 1'])
  })

  it('rotates continuous listening without dropping silence, audio, or final text', async () => {
    const chunks: number[][] = []
    const frames: Record<string, unknown>[][] = []
    const closed: number[] = []
    const provider = createGeminiLiveProvider(undefined, {
      isContinuous: true,
      maxConnectionMs: 1000,
    })({
      apiKey: 'test-key',
      openSocket: async () => {
        const index = chunks.length
        chunks.push([])
        frames.push([])
        const messages = createAsyncQueue<string>()
        messages.push(JSON.stringify({ setupComplete: {} }))
        return {
          messages: messages.values,
          close: () => {
            closed.push(index)
            messages.end()
          },
          send: (raw) => {
            const frame = JSON.parse(raw as string)
            frames[index].push(frame)
            const data = frame.realtimeInput?.mediaChunks?.[0]?.data
            if (data) chunks[index].push(Buffer.from(data, 'base64')[0])
            if (frame.realtimeInput?.activityEnd)
              messages.push(
                JSON.stringify({
                  serverContent: {
                    inputTranscription: { text: `Part ${index}` },
                    turnComplete: true,
                  },
                })
              )
          },
        }
      },
    })
    const stream = await provider.transcribeStream!({
      modelId: 'gemini-3.5-transcribe-live',
      options: {},
      sampleRate: 10,
      signal: new AbortController().signal,
      audio: {
        async *[Symbol.asyncIterator]() {
          for (const value of [0, 1, 2])
            yield { data: new Uint8Array(20).fill(value) }
        },
      },
    })
    const events = []
    for await (const event of stream) events.push(event)
    expect(chunks).toEqual([[0], [1], [2]])
    expect(closed).toEqual([0, 1, 2])
    expect(
      events.map((event) => event.type === 'final' && event.segment.text)
    ).toEqual(['Part 0', 'Part 1', 'Part 2'])
    expect(
      frames.every(
        (sent) =>
          sent.filter(
            (frame) =>
              (frame.realtimeInput as { activityEnd?: unknown } | undefined)
                ?.activityEnd
          ).length === 1
      )
    ).toBe(true)
  })

  it('converts uint8array to base64', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111])
    expect(uint8ArrayToBase64(bytes)).toBe('SGVsbG8=')
  })

  it('parses valid json message and rejects invalid json', () => {
    expect(parseGeminiLiveMessage('{"setupComplete":{}}')).toEqual({
      setupComplete: {},
    })
    expect(() => parseGeminiLiveMessage('not-json')).toThrowError(
      /Gemini Live sent a message that is not JSON/
    )
  })

  it('sends setup message with systemInstruction and streams audio chunks', async () => {
    const sent: string[] = []
    const send = vi.fn((data: string) => sent.push(data))
    const close = vi.fn()

    const provider = createGeminiLiveProvider('Custom prompt rules')({
      apiKey: 'test-key',
      openSocket: async () => ({
        messages: {
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify({ setupComplete: {} })
            yield JSON.stringify({
              serverContent: { modelTurn: { parts: [{ text: 'Hello' }] } },
            })
            yield JSON.stringify({
              serverContent: {
                modelTurn: { parts: [{ text: ' world' }] },
                turnComplete: true,
              },
            })
          },
        },
        send,
        close,
      }),
    })

    const audioChunk = new Uint8Array([0, 16, 0, 16])
    const events = await provider.transcribeStream!({
      modelId: 'gemini-3.5-transcribe-live',
      options: {},
      sampleRate: 16000,
      signal: new AbortController().signal,
      audio: {
        async *[Symbol.asyncIterator]() {
          yield { data: audioChunk }
        },
      },
    })

    const collected: unknown[] = []
    for await (const event of events) {
      collected.push(event)
    }

    // Verify setup frame was sent
    expect(sent.length).toBeGreaterThanOrEqual(2)
    const setup = JSON.parse(sent[0])
    expect(setup).toEqual({
      setup: {
        model: 'models/gemini-3.5-transcribe-live',
        generationConfig: { responseModalities: ['TEXT'] },
        inputAudioTranscription: { mode: 'SMART' },
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        systemInstruction: { parts: [{ text: 'Custom prompt rules' }] },
      },
    })

    // Verify audio chunk was sent
    const chunkMessage = JSON.parse(sent[2])
    expect(chunkMessage.realtimeInput.mediaChunks[0].mimeType).toBe(
      'audio/pcm;rate=16000'
    )
    expect(chunkMessage.realtimeInput.mediaChunks[0].data).toBe(
      uint8ArrayToBase64(audioChunk)
    )

    // Verify audioStreamEnd was sent
    const endMessage = JSON.parse(sent[3])
    expect(endMessage.realtimeInput.activityEnd).toEqual({})

    // Verify collected stream events
    expect(collected).toEqual([
      { type: 'partial', text: 'Hello', startMs: 0 },
      { type: 'partial', text: 'Hello world', startMs: 0 },
      {
        type: 'final',
        segment: { startMs: 0, endMs: 1000, text: 'Hello world' },
      },
    ])
    expect(close).toHaveBeenCalled()
  })

  it('passes language codes and uses default transcribe model', async () => {
    const sent: string[] = []
    const send = vi.fn((data: string) => sent.push(data))

    const provider = createGeminiLiveProvider()({
      apiKey: 'test-key',
      openSocket: async () => ({
        messages: {
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify({ setupComplete: {} })
          },
        },
        send,
        close: vi.fn(),
      }),
    })

    const events = await provider.transcribeStream!({
      modelId: '',
      options: { language: 'ru' },
      sampleRate: 16000,
      signal: new AbortController().signal,
      audio: {
        async *[Symbol.asyncIterator]() {
          yield { data: new Uint8Array([0, 16]) }
        },
      },
    })

    for await (const _ of events) {
      // consume
    }

    expect(sent.length).toBeGreaterThanOrEqual(1)
    const setup = JSON.parse(sent[0])
    expect(setup.setup.model).toBe('models/gemini-3.5-transcribe-live')
    expect(setup.setup.inputAudioTranscription).toEqual({
      mode: 'SMART',
      languageCodes: ['ru'],
    })
  })

  it('resets accumulated turn text on interrupted', async () => {
    const provider = createGeminiLiveProvider()({
      apiKey: 'test-key',
      openSocket: async () => ({
        messages: {
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify({ setupComplete: {} })
            yield JSON.stringify({
              serverContent: {
                modelTurn: { parts: [{ text: 'Interrupted draft' }] },
              },
            })
            yield JSON.stringify({ serverContent: { interrupted: true } })
            yield JSON.stringify({
              serverContent: {
                modelTurn: { parts: [{ text: 'Fresh start' }] },
                turnComplete: true,
              },
            })
          },
        },
        send: vi.fn(),
        close: vi.fn(),
      }),
    })

    const events = await provider.transcribeStream!({
      modelId: 'gemini-3.8-live',
      options: {},
      sampleRate: 16000,
      signal: new AbortController().signal,
      audio: {
        async *[Symbol.asyncIterator]() {
          yield { data: new Uint8Array([0, 16]) }
        },
      },
    })

    const collected: unknown[] = []
    for await (const event of events) {
      collected.push(event)
    }

    expect(collected).toEqual([
      { type: 'partial', text: 'Interrupted draft', startMs: 0 },
      { type: 'partial', text: 'Fresh start', startMs: 0 },
      {
        type: 'final',
        segment: { startMs: 0, endMs: 1000, text: 'Fresh start' },
      },
    ])
  })

  it('yields inputTranscription as final and interimInputTranscription as partial', async () => {
    const provider = createGeminiLiveProvider()({
      apiKey: 'test-key',
      openSocket: async () => ({
        messages: {
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify({
              serverContent: {
                interimInputTranscription: { text: 'test speech' },
              },
            })
            yield JSON.stringify({
              serverContent: {
                inputTranscription: { text: 'test speech finalized' },
              },
            })
          },
        },
        send: vi.fn(),
        close: vi.fn(),
      }),
    })

    const events = await provider.transcribeStream!({
      modelId: 'gemini-3.5-transcribe-live',
      options: {},
      sampleRate: 16000,
      signal: new AbortController().signal,
      audio: {
        async *[Symbol.asyncIterator]() {
          yield { data: new Uint8Array([0, 16]) }
        },
      },
    })

    const collected: unknown[] = []
    for await (const event of events) {
      collected.push(event)
    }

    expect(collected).toEqual([
      { type: 'partial', text: 'test speech', startMs: 0 },
      {
        type: 'final',
        segment: { startMs: 0, endMs: 1000, text: 'test speech finalized' },
      },
    ])
  })

  it('throws when server sends an error message', async () => {
    const provider = createGeminiLiveProvider()({
      apiKey: 'test-key',
      openSocket: async () => ({
        messages: {
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify({
              error: { message: 'Quota exceeded', code: 429 },
            })
          },
        },
        send: vi.fn(),
        close: vi.fn(),
      }),
    })

    const events = await provider.transcribeStream!({
      modelId: 'gemini-2.0-flash',
      options: {},
      sampleRate: 16000,
      signal: new AbortController().signal,
      audio: {
        async *[Symbol.asyncIterator]() {
          yield { data: new Uint8Array([0, 16]) }
        },
      },
    })

    await expect(async () => {
      for await (const event of events) {
        expect(event).toBeDefined()
      }
    }).rejects.toMatchObject({
      kind: 'provider_unavailable',
      message: 'Quota exceeded',
    })
  })
})
