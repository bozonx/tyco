import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface VoiceOrigin {
  mode: 'selectionActions'
  text?: string | null
  activationId: number
}

/**
 * Text displayed for reference during one voice-input activation, and origin
 * information if voice/listen was started from an action menu.
 */
export const useVoiceReferenceStore = defineStore('voiceReference', () => {
  const reference = ref<{ text: string; activationId: number } | null>(null)
  const origin = ref<VoiceOrigin | null>(null)

  return {
    offer: (text: string, activationId: number) => {
      reference.value = { text, activationId }
      origin.value = { mode: 'selectionActions', text, activationId }
    },
    offerOrigin: (nextOrigin: VoiceOrigin) => {
      origin.value = nextOrigin
      if (nextOrigin.text) {
        reference.value = {
          text: nextOrigin.text,
          activationId: nextOrigin.activationId,
        }
      }
    },
    /** The reference text for `activationId`, if voice input was started for it */
    contextFor: (activationId: number) =>
      reference.value?.activationId === activationId
        ? reference.value.text
        : undefined,
    originFor: (activationId: number) =>
      origin.value?.activationId === activationId ? origin.value : undefined,
    clear: () => {
      reference.value = null
      origin.value = null
    },
  }
})
