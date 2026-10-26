import { AiError } from '@bozonx/ai-kit'
import {
  deepgramSttProvider,
  type SttProviderFactory,
} from '@bozonx/ai-kit/stt'

import { confirmedSocket } from './confirmed-socket'

interface DeepgramLiveMessage {
  type?: string
  description?: string
  message?: string
  channel?: { alternatives?: { transcript?: string }[] }
}

/** The last message read: each one is checked and then rewritten */
let lastParsed: { message: string; event: DeepgramLiveMessage } | undefined

function parseDeepgramMessage(message: string): DeepgramLiveMessage {
  if (lastParsed?.message === message) return lastParsed.event
  let event: DeepgramLiveMessage
  try {
    event = JSON.parse(message) as DeepgramLiveMessage
  } catch {
    throw new AiError(
      'provider_unavailable',
      'Deepgram sent a message that is not JSON',
      { provider: 'deepgram' }
    )
  }
  lastParsed = { message, event }
  return event
}

/**
 * The kit skips a result without text, yet an empty one is how Deepgram drops
 * its previous guess: noise it heard as words and then settled as nothing.
 * Skipped, that guess would stay on screen and end up in the text. A single
 * space reaches the transcript as a result that clears the guess and adds no
 * words.
 */
export function keepEmptyDeepgramResult(message: string): string {
  const event = parseDeepgramMessage(message)
  const alternative = event.channel?.alternatives?.[0]
  if (event.type !== 'Results' || !alternative || alternative.transcript)
    return message
  return JSON.stringify({
    ...event,
    channel: {
      ...event.channel,
      alternatives: [
        { ...alternative, transcript: ' ' },
        ...(event.channel?.alternatives?.slice(1) ?? []),
      ],
    },
  })
}

/** Deepgram's terminal Metadata confirms that CloseStream flushed the audio. */
export const createDeepgramProvider: SttProviderFactory = (init) =>
  deepgramSttProvider({
    ...init,
    openSocket: confirmedSocket(init, {
      providerName: 'Deepgram',
      providerId: 'deepgram',
      confirmsFinal: (message) => {
        const event = parseDeepgramMessage(message)
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
      rewrite: keepEmptyDeepgramResult,
    }),
  })
