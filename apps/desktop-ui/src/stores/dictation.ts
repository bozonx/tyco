import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { clientLogger } from '../lib/logger'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { createLiveDictation } from '../lib/stt/live-dictation'
import { createDictationOwnership } from '../lib/stt/dictation-ownership'
import { createSttClient } from '../lib/stt/stt-client'
import { createVoiceCaptureControl } from '../lib/stt/voice-capture'

/** Owns the microphone session for one application instance. */
export const useDictationStore = defineStore('dictation', () => {
  const model = createLiveDictation({
    capture: createVoiceCaptureControl(tauriNetIpc),
    stt: createSttClient({ transport: createTauriTransport(tauriNetIpc) }),
  })
  onScopeDispose(() => {
    void model.cancel().catch((error: unknown) => {
      clientLogger.error('Could not cancel the dictation session', error, 'stt')
    })
  })
  return { ...model, ...createDictationOwnership(model) }
})
