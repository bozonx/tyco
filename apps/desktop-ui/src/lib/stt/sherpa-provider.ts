import {
  sherpaOnnxSttProvider,
  type SttProviderFactory,
} from '@bozonx/ai-kit/stt'

import { confirmedSocket } from './confirmed-socket'

/**
 * A clean socket close alone does not confirm that sherpa decoded the final
 * audio.
 */
export const createSherpaProvider: SttProviderFactory = (init) =>
  sherpaOnnxSttProvider({
    ...init,
    openSocket: confirmedSocket(init, {
      providerName: 'Sherpa',
      providerId: 'sherpa-onnx',
      confirmsFinal: (message) => message === 'Done!',
    }),
  })
