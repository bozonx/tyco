import { expect, it, vi } from 'vitest'
import { createSherpaProvider } from './sherpa-provider'

async function transcribe(messages: string[]) {
  const provider = createSherpaProvider({
    apiKey: '',
    openSocket: async () => ({
      messages: {
        async *[Symbol.asyncIterator]() {
          yield* messages
        },
      },
      send: vi.fn(),
      close: vi.fn(),
    }),
  })
  const events = await provider.transcribeStream!({
    modelId: 'streaming',
    options: {},
    sampleRate: 16000,
    signal: new AbortController().signal,
    audio: {
      async *[Symbol.asyncIterator]() {
        /* Empty recording. */
      },
    },
  })
  for await (const _event of events) {
    /* Drain the protocol. */
  }
}

it('requires the final Done response instead of accepting a clean premature close', async () => {
  await expect(transcribe([])).rejects.toMatchObject({
    kind: 'stream_interrupted',
  })
  await expect(transcribe(['Done!'])).resolves.toBeUndefined()
})
