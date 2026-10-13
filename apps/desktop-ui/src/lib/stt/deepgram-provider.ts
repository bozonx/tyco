import { AiError } from '@bozonx/ai-kit'
import {
  deepgramSttProvider,
  type SttProviderFactory,
} from '@bozonx/ai-kit/stt'

/** Deepgram's terminal Metadata confirms that CloseStream flushed the audio. */
export const createDeepgramProvider: SttProviderFactory = (init) =>
  deepgramSttProvider({
    ...init,
    openSocket: async (url, options) => {
      if (!init.openSocket)
        throw new Error('Deepgram requires the desktop socket transport')
      const session = await init.openSocket(url, options)
      return {
        ...session,
        messages: {
          async *[Symbol.asyncIterator]() {
            let finalized = false
            for await (const message of session.messages) {
              const event = JSON.parse(message) as {
                type?: string
                description?: string
                message?: string
              }
              if (event.type === 'Error')
                throw new AiError(
                  'provider_unavailable',
                  event.description ??
                    event.message ??
                    'Deepgram rejected the live session',
                  { provider: 'deepgram' }
                )
              if (event.type === 'Metadata') finalized = true
              yield message
            }
            if (!finalized)
              throw new AiError(
                'stream_interrupted',
                'Deepgram closed without confirming the final transcription',
                { provider: 'deepgram' }
              )
          },
        },
      }
    },
  })
