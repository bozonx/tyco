import { AiError } from '@bozonx/ai-kit'
import {
  deepgramSttProvider,
  type SttProviderFactory,
} from '@bozonx/ai-kit/stt'

import { confirmedSocket } from './confirmed-socket'

/** Deepgram's terminal Metadata confirms that CloseStream flushed the audio. */
export const createDeepgramProvider: SttProviderFactory = (init) =>
  deepgramSttProvider({
    ...init,
    openSocket: confirmedSocket(init, {
      providerName: 'Deepgram',
      providerId: 'deepgram',
      confirmsFinal: (message) => {
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
        return event.type === 'Metadata'
      },
    }),
  })
