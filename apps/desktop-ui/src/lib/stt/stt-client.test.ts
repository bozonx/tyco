import { describe, expect, it, vi } from 'vitest'

import { buildSttCatalog, createSttClient } from './stt-client'

const model = {
  id: 'local-stt',
  provider: 'openai-compatible' as const,
  model: 'whisper-1',
  baseUrl: 'http://localhost:8000/v1/',
}

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
      recording: { sampleRate: 16_000, samples: [-1, 0, 1] },
      language: 'en',
      hasApiKey: true,
    })

    expect(text).toBe('recognized text')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:8000/v1/audio/transcriptions'
    )
  })
})
