import { AiError } from '@bozonx/ai-kit'
import {
  sherpaOnnxSttProvider,
  type SttProviderFactory,
} from '@bozonx/ai-kit/stt'

/**
 * A clean socket close alone does not confirm that sherpa decoded the final
 * audio.
 */
export const createSherpaProvider: SttProviderFactory = (init) =>
  sherpaOnnxSttProvider({
    ...init,
    openSocket: async (url, options) => {
      if (!init.openSocket)
        throw new Error('Sherpa requires the desktop socket transport')
      const session = await init.openSocket(url, options)
      return {
        ...session,
        messages: {
          async *[Symbol.asyncIterator]() {
            let finalized = false
            for await (const message of session.messages) {
              if (message === 'Done!') finalized = true
              yield message
            }
            if (!finalized)
              throw new AiError(
                'stream_interrupted',
                'Sherpa closed without confirming the final transcription',
                { provider: 'sherpa-onnx' }
              )
          },
        },
      }
    },
  })
