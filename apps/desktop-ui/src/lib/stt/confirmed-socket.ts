import { AiError } from '@bozonx/ai-kit'
import type { SttProviderFactory } from '@bozonx/ai-kit/stt'

type SttProviderInit = Parameters<SttProviderFactory>[0]
type OpenSocket = NonNullable<SttProviderInit['openSocket']>

export interface ConfirmedSocketOptions {
  /** The provider name for messages, e.g. `Deepgram` */
  providerName: string
  /** The provider id for errors, e.g. `deepgram` */
  providerId: string
  /**
   * Checks one message, throwing for an error the provider reports; true once
   * the message confirms that the final audio was transcribed
   */
  confirmsFinal: (message: string) => boolean
  /** Adapts one message before the provider reads it */
  rewrite?: (message: string) => string
}

/**
 * Opens the desktop socket of a live STT session that fails when it closes
 * before the provider confirmed the final transcription
 */
export function confirmedSocket(
  init: SttProviderInit,
  options: ConfirmedSocketOptions
): OpenSocket {
  return async (url, socketOptions) => {
    if (!init.openSocket)
      throw new Error(
        `${options.providerName} requires the desktop socket transport`
      )
    const session = await init.openSocket(url, socketOptions)
    return {
      ...session,
      messages: {
        async *[Symbol.asyncIterator]() {
          let finalized = false
          for await (const message of session.messages) {
            if (options.confirmsFinal(message)) finalized = true
            yield options.rewrite ? options.rewrite(message) : message
          }
          if (!finalized)
            throw new AiError(
              'stream_interrupted',
              `${options.providerName} closed without confirming the final transcription`,
              { provider: options.providerId }
            )
        },
      },
    }
  }
}
