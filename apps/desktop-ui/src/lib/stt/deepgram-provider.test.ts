import { expect, it, vi } from 'vitest'
import { createDeepgramProvider } from './deepgram-provider'

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
  for await (const _event of events) {
    /* Drain the session. */
  }
}

it('requires terminal metadata even when the socket closes cleanly', async () => {
  await expect(transcribe([])).rejects.toMatchObject({
    kind: 'stream_interrupted',
  })
  await expect(transcribe([{ type: 'Metadata' }])).resolves.toBeUndefined()
})

it('reports provider error messages instead of ignoring them', async () => {
  await expect(
    transcribe([{ type: 'Error', description: 'Invalid language' }])
  ).rejects.toThrow('Invalid language')
})
