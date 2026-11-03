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
          if (JSON.parse(raw as string).realtimeInput?.audioStreamEnd) endSent()
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
        if (event.type === 'final' && event.segment.text === 'First')
          audio.end()
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

    const audioChunk = new Uint8Array([1, 2, 3, 4])
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
        inputAudioTranscription: { mode: 'smart' },
        systemInstruction: { parts: [{ text: 'Custom prompt rules' }] },
      },
    })

    // Verify audio chunk was sent
    const chunkMessage = JSON.parse(sent[1])
    expect(chunkMessage.realtimeInput.mediaChunks[0].mimeType).toBe(
      'audio/pcm;rate=16000'
    )
    expect(chunkMessage.realtimeInput.mediaChunks[0].data).toBe(
      uint8ArrayToBase64(audioChunk)
    )

    // Verify audioStreamEnd was sent
    const endMessage = JSON.parse(sent[2])
    expect(endMessage.realtimeInput.audioStreamEnd).toBe(true)

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
      audio: { async *[Symbol.asyncIterator]() {} },
    })

    for await (const _ of events) {
      // consume
    }

    expect(sent.length).toBeGreaterThanOrEqual(1)
    const setup = JSON.parse(sent[0])
    expect(setup.setup.model).toBe('models/gemini-3.5-transcribe-live')
    expect(setup.setup.inputAudioTranscription).toEqual({
      mode: 'smart',
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
      audio: { async *[Symbol.asyncIterator]() {} },
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
      audio: { async *[Symbol.asyncIterator]() {} },
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
      audio: { async *[Symbol.asyncIterator]() {} },
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
