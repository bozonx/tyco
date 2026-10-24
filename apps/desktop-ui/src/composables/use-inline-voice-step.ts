import { computed } from 'vue'

import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'

/**
 * The voice input step while it is open; with `inline` set it runs in a bar
 * under the editor or the chat, which stays in view
 */
export function useInlineVoiceStep() {
  const menuModalsStore = useMenuModalsStore()
  const voiceParams = computed(() => {
    const step = menuModalsStore.currentStep
    return step?.modal === MenuModals.VOICE_RECOGNITION
      ? step.params
      : undefined
  })
  const isInlineVoice = computed(() => Boolean(voiceParams.value?.inline))
  return { voiceParams, isInlineVoice }
}
