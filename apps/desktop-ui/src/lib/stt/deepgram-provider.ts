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

function parseDeepgramMessage(message: string): DeepgramLiveMessage {
  try {
    return JSON.parse(message) as DeepgramLiveMessage
  } catch {
    throw new AiError(
      'provider_unavailable',
      'Deepgram sent a message that is not JSON',
      { provider: 'deepgram' }
    )
  }
}

/**
 * Each message is checked and then rewritten: the parse is kept for the message
 * it belongs to, so that it is done once. Owned by one provider instance, not
 * shared by the module.
 */
function createDeepgramParser(): (message: string) => DeepgramLiveMessage {
  let last: { message: string; event: DeepgramLiveMessage } | undefined
  return (message) => {
    if (last?.message === message) return last.event
    const event = parseDeepgramMessage(message)
    last = { message, event }
    return event
  }
}

/**
 * The kit skips a result without text, yet an empty one is how Deepgram drops
 * its previous guess: noise it heard as words and then settled as nothing.
 * Skipped, that guess would stay on screen and end up in the text. A single
 * space reaches the transcript as a result that clears the guess and adds no
 * words.
 */
function keepEmptyDeepgramResult(
  message: string,
  parse: (message: string) => DeepgramLiveMessage = parseDeepgramMessage
): string {
  const event = parse(message)
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
export const createDeepgramProvider: SttProviderFactory = (init) => {
  const parse = createDeepgramParser()
  return deepgramSttProvider({
    ...init,
    openSocket: confirmedSocket(init, {
      providerName: 'Deepgram',
      providerId: 'deepgram',
      confirmsFinal: (message) => {
        const event = parse(message)
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
      rewrite: (message) => keepEmptyDeepgramResult(message, parse),
    }),
  })
}
