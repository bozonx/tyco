import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Text displayed for reference during one voice-input activation. It is never
 * part of the dictated output or an AI instruction.
 */
export const useVoiceReferenceStore = defineStore('voiceReference', () => {
  const reference = ref<{ text: string; activationId: number } | null>(null)

  return {
    offer: (text: string, activationId: number) => {
      reference.value = { text, activationId }
    },
    /** The reference text for `activationId`, if voice input was started for it */
    contextFor: (activationId: number) =>
      reference.value?.activationId === activationId
        ? reference.value.text
        : undefined,
    clear: () => {
      reference.value = null
    },
  }
})
