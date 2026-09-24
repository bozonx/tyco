import { describe, expect, it, vi } from 'vitest'

import { buildSttCatalog, createSttClient } from './stt-client'

const model = {
  id: 'local-stt',
  provider: 'openai-compatible' as const,
  model: 'whisper-1',
  baseUrl: 'http://localhost:8000/v1/',
}

function pcm16Wav(sampleRate = 16_000, samples = 4_000): Uint8Array {
  const wav = new Uint8Array(44 + samples * 2)
  const view = new DataView(wav.buffer)
  wav.set(new TextEncoder().encode('RIFF'), 0)
  view.setUint32(4, wav.byteLength - 8, true)
  wav.set(new TextEncoder().encode('WAVEfmt '), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  wav.set(new TextEncoder().encode('data'), 36)
  view.setUint32(40, samples * 2, true)
  return wav
}

const wav = pcm16Wav()

describe('buildSttCatalog', () => {
  it('maps the configured model to an unpriced speech task', () => {
    const catalog = buildSttCatalog(model)

    expect(catalog.kindOf('transcription')).toBe('stt')
    expect(catalog.require('local-stt')).toMatchObject({
      kind: 'stt',
      provider: 'openai-compatible',
      model: 'whisper-1',
      baseUrl: 'http://localhost:8000/v1/',
    })
  })

  it('rejects incomplete custom endpoint configuration', () => {
    expect(() => buildSttCatalog({ ...model, model: ' ' })).toThrow(
      'model name is empty'
    )
    expect(() => buildSttCatalog({ ...model, baseUrl: 'file:///tmp' })).toThrow(
      'valid HTTP URL'
    )
  })
})

describe('createSttClient', () => {
  it('transcribes recorded audio through ai-kit and the supplied transport', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const form = init?.body as FormData
        expect(form.get('model')).toBe('whisper-1')
        expect(form.get('language')).toBe('en')
        expect(form.get('response_format')).toBe('verbose_json')
        expect(form.getAll('timestamp_granularities[]')).toEqual(['segment'])

        const file = form.get('file') as File
        expect(file.type).toBe('audio/wav')
        expect(
          new TextDecoder().decode((await file.arrayBuffer()).slice(0, 4))
        ).toBe('RIFF')
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer tyco-secret:local-stt'
        )

        return new Response(
          JSON.stringify({
            text: ' recognized text ',
            duration: 0.25,
            segments: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
    )
    const client = createSttClient({
      transport: {
        fetch: fetchMock,
        openSocket: vi.fn(() => Promise.reject(new Error('Unexpected socket'))),
      },
    })

    const text = await client.transcribe({
      model,
      recording: { sampleRate: 16_000, durationMs: 250, wav },
      language: 'en',
      hasApiKey: true,
    })

    expect(text).toBe('recognized text')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:8000/v1/audio/transcriptions'
    )
  })

  it('rejects empty and malformed recordings before making a request', async () => {
    const fetchMock = vi.fn()
    const client = createSttClient({
      transport: {
        fetch: fetchMock,
        openSocket: vi.fn(() => Promise.reject(new Error('Unexpected socket'))),
      },
    })

    await expect(
      client.transcribe({
        model,
        recording: { sampleRate: 16_000, durationMs: 0, wav },
      })
    ).rejects.toThrow('empty or too short')
    await expect(
      client.transcribe({
        model,
        recording: {
          sampleRate: 16_000,
          durationMs: 250,
          wav: new Uint8Array(44),
        },
      })
    ).rejects.toThrow('valid WAV')
    await expect(
      client.transcribe({
        model,
        recording: { sampleRate: 8_000, durationMs: 250, wav },
      })
    ).rejects.toThrow('sample rate does not match')
    await expect(
      client.transcribe({
        model,
        recording: { sampleRate: 16_000, durationMs: 5_000, wav },
      })
    ).rejects.toThrow('duration does not match')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
