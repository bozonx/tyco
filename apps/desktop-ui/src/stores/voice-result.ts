import { defineStore } from 'pinia'
import { markRaw, onScopeDispose } from 'vue'

import { createVoiceResultStep } from '../lib/stt/voice-result-step'
import { useDesktopStore } from './desktop'
import { useHistoryStore } from './history'

/**
 * The result step of the voice input in the quick window. It outlives the
 * screen, so a hidden window or a switch to another mode does not drop a
 * dictation the user has not taken yet; it closes once the text leaves the app,
 * on Esc, or when a new dictation starts.
 *
 * Intentional: this is the open step itself, not a copy of the input. Nothing
 * is kept after the step closes; the history is the only store of user input
 */
export const useVoiceResultStore = defineStore('voiceResult', () => {
  const desktop = useDesktopStore()
  const step = createVoiceResultStep()
  const stopOutput = useHistoryStore().onOutput(() => {
    if (desktop.desktopState.mode === 'voice') step.resetResult()
  })
  onScopeDispose(stopOutput)
  return { step: markRaw(step) }
})
