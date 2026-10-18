import type { AudioChunk, TranscriptPart } from '@bozonx/ai-kit'
import { describe, expect, it, vi } from 'vitest'

import { createAsyncQueue } from '../net/async-queue'
import { createLiveDictation } from './live-dictation'
import type { LiveTranscriptState } from './live-transcript'
import type { SttClient, SttLiveRequest } from './stt-client'
import type { VoiceCaptureControl } from './voice-capture'

const model = { provider: 'deepgram' as const, modelId: 'nova-3' }

/** A microphone whose audio ends when stopped, and a provider driven by hand */
function setup(finishTimeoutMs?: number) {
  const audio = createAsyncQueue<AudioChunk>()
  const parts = createAsyncQueue<TranscriptPart>()
  const requests: SttLiveRequest[] = []
  const capture: VoiceCaptureControl = {
    start: vi.fn(async () => ({ sampleRate: 16_000, audio: audio.values })),
    stop: vi.fn(async () => audio.end()),
  }
  const stt: SttClient = {
    transcribeLive: (request) => {
      requests.push(request)
      return parts.values
    },
  }
  const texts: LiveTranscriptState[] = []
  const onError = vi.fn()
  const dictation = createLiveDictation({ capture, stt, finishTimeoutMs })
  const start = () =>
    dictation.start({
      model,
      hasApiKey: true,
      onText: (state) => texts.push(state),
      onError,
    })
  return { audio, parts, requests, capture, texts, onError, dictation, start }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createLiveDictation', () => {
  it('shows the text as it is recognized and returns it when finished', async () => {
    const t = setup()
    await t.start()

    t.parts.push({ type: 'partial', text: 'hello', startMs: 0 })
    t.parts.push({
      type: 'final',
      segment: { index: 0, startMs: 0, endMs: 900, text: 'Hello world.' },
    })
    await tick()
    expect(t.texts.map((state) => state.draft)).toEqual(['hello', ''])

    const finished = t.dictation.finish()
    t.parts.push({ type: 'finish' })
    t.parts.end()

    expect(await finished).toBe('Hello world.')
    expect(t.capture.stop).toHaveBeenCalledOnce()
    expect(t.requests[0]).toMatchObject({ sampleRate: 16_000, hasApiKey: true })
    expect(t.onError).not.toHaveBeenCalled()
  })

  it('turns the microphone off on a provider failure and keeps the text', async () => {
    const t = setup()
    await t.start()

    t.parts.push({
      type: 'final',
      segment: { index: 0, startMs: 0, endMs: 900, text: 'Kept.' },
    })
    t.parts.push({
      type: 'error',
      kind: 'provider_unavailable',
      message: 'deepgram live session failed',
      recoverable: true,
    })
    await tick()

    expect(t.onError).toHaveBeenCalledWith(
      new Error('deepgram live session failed')
    )
    expect(t.capture.stop).toHaveBeenCalled()
    expect(await t.dictation.finish()).toBe('Kept.')
  })

  it('fails the finish when nothing was recognized before a failure', async () => {
    const t = setup()
    await t.start()

    t.parts.fail(new Error('Invalid credentials'))
    await tick()

    await expect(t.dictation.finish()).rejects.toThrow('Invalid credentials')
  })

  it('keeps the text when the provider never sends its last words', async () => {
    const t = setup(20)
    await t.start()

    t.parts.push({
      type: 'final',
      segment: { index: 0, startMs: 0, endMs: 900, text: 'Kept.' },
    })
    await tick()

    expect(await t.dictation.finish()).toBe('Kept.')
    expect(t.requests[0].signal?.aborted).toBe(true)
  })

  it('cancels quietly', async () => {
    const t = setup()
    await t.start()

    const cancelled = t.dictation.cancel()
    expect(t.requests[0].signal?.aborted).toBe(true)
    t.parts.fail(new Error('aborted'))
    await cancelled

    expect(t.capture.stop).toHaveBeenCalled()
    expect(t.onError).not.toHaveBeenCalled()
  })

  it('reports a provider that closes while the microphone is recording', async () => {
    const t = setup()
    await t.start()
    t.parts.end()
    await tick()

    expect(t.capture.stop).toHaveBeenCalledOnce()
    expect(t.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'closed',
        message: 'The speech recognition session closed while recording',
      })
    )
    await expect(t.dictation.finish()).rejects.toThrow('closed while recording')
  })

  it('reports a finish timeout when the provider never returned any text', async () => {
    const t = setup(20)
    await t.start()

    await expect(t.dictation.finish()).rejects.toThrow(
      'Timed out waiting for the speech recognition result'
    )
    expect(t.requests[0].signal?.aborted).toBe(true)
  })

  it('returns the text even when the microphone fails to stop', async () => {
    const t = setup(20)
    vi.mocked(t.capture.stop).mockRejectedValue(new Error('ipc'))
    await t.start()
    t.parts.push({
      type: 'final',
      segment: { index: 0, startMs: 0, endMs: 900, text: 'Kept.' },
    })
    await tick()

    expect(await t.dictation.finish()).toBe('Kept.')
  })

  it('bounds a stalled microphone stop and warns while keeping recognized text', async () => {
    const t = setup(20)
    await t.start()
    t.parts.push({ type: 'partial', text: 'Kept.', startMs: 0 })
    await tick()
    vi.mocked(t.capture.stop).mockImplementation(() => new Promise(() => {}))
    expect(await t.dictation.finish()).toBe('Kept.')
    expect(t.onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'timeout' })
    )
    expect(t.requests[0].signal?.aborted).toBe(true)
  })

  it('turns the microphone off when the transcription cannot start', async () => {
    const t = setup()
    const dictation = createLiveDictation({
      capture: t.capture,
      stt: {
        transcribeLive: () => {
          throw new Error('bad model')
        },
      },
    })

    await expect(
      dictation.start({
        model,
        hasApiKey: true,
        onText: () => {},
        onError: () => {},
      })
    ).rejects.toThrow('bad model')
    expect(t.capture.stop).toHaveBeenCalledOnce()
  })

  it('turns the microphone off when cancelled while it was starting', async () => {
    const t = setup()
    let started!: () => void
    vi.mocked(t.capture.start).mockImplementation(
      () =>
        new Promise((resolve) => {
          started = () => resolve({ sampleRate: 16_000, audio: t.audio.values })
        })
    )
    const starting = t.start()
    await tick()
    const cancelled = t.dictation.cancel()
    started()
    await starting
    await cancelled

    expect(t.requests).toHaveLength(0)
    expect(t.capture.stop).toHaveBeenCalled()
  })
})
