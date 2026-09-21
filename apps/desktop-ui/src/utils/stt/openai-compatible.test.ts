import { afterEach, describe, expect, it, vi } from 'vitest'

import { transcribeOpenAiCompatible } from './openai-compatible'

describe('transcribeOpenAiCompatible', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends recorded audio as a WAV file to the transcription endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ text: ' recognized text ' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeOpenAiCompatible(
      {
        id: 'local-stt',
        provider: 'openai-compatible',
        model: 'whisper-1',
        baseUrl: 'http://localhost:8000/v1/',
        apiKey: 'secret',
      },
      { sampleRate: 16_000, samples: [-1, 0, 1] },
      'en'
    )

    expect(text).toBe('recognized text')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8000/v1/audio/transcriptions')
    expect(init.headers).toEqual({ Authorization: 'Bearer secret' })

    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('language')).toBe('en')

    const file = form.get('file') as File
    expect(file.name).toBe('recording.wav')
    expect(file.type).toBe('audio/wav')
    expect(
      new TextDecoder().decode((await file.arrayBuffer()).slice(0, 4))
    ).toBe('RIFF')
  })
})
