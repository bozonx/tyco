import type { TranscriptPart } from '@bozonx/ai-kit'
import { expect, it, vi } from 'vitest'
import { createDeepgramProvider } from './deepgram-provider'
import {
  applyTranscriptPart,
  createLiveTranscriptState,
  liveTranscriptText,
} from './live-transcript'

async function transcribe(messages: object[]) {
  const provider = createDeepgramProvider({
    apiKey: 'reference',
    openSocket: async () => ({
      messages: {
        async *[Symbol.asyncIterator]() {
          for (const message of messages) yield JSON.stringify(message)
        },
      },
      send: vi.fn(),
      close: vi.fn(),
    }),
  })
  const events = await provider.transcribeStream!({
    modelId: 'nova-3',
    options: {},
    sampleRate: 16000,
    signal: new AbortController().signal,
    audio: {
      async *[Symbol.asyncIterator]() {
        /* No audio needed to exercise terminal messages. */
      },
    },
  })
  const parts: TranscriptPart[] = []
  for await (const event of events) parts.push(event as TranscriptPart)
  return parts
}

const result = (transcript: string, isFinal: boolean) => ({
  type: 'Results',
  is_final: isFinal,
  channel: { alternatives: [{ transcript }] },
})

it('requires terminal metadata even when the socket closes cleanly', async () => {
  await expect(transcribe([])).rejects.toMatchObject({
    kind: 'stream_interrupted',
  })
  await expect(transcribe([{ type: 'Metadata' }])).resolves.toEqual([])
})

it('reports provider error messages instead of ignoring them', async () => {
  await expect(
    transcribe([{ type: 'Error', description: 'Invalid language' }])
  ).rejects.toThrow('Invalid language')
})

it.each([true, false])(
  'drops a guess that Deepgram replaces with nothing (final: %s)',
  async (isFinal) => {
    const parts = await transcribe([
      result('Hello', true),
      result('uh', false),
      result('', isFinal),
      { type: 'Metadata' },
    ])
    const state = parts.reduce(applyTranscriptPart, createLiveTranscriptState())
    expect(liveTranscriptText(state)).toBe('Hello')
  }
)
