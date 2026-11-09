import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * The transcript a voice reply answers: "Reply by voice" in the listening
 * overlay hands it to the voice input it switches to. It belongs to that one
 * activation of the quick window and to no later one.
 */
export const useListenReplyStore = defineStore('listenReply', () => {
  const reply = ref<{ text: string; activationId: number } | null>(null)

  return {
    offer: (text: string, activationId: number) => {
      reply.value = { text, activationId }
    },
    /** The transcript for `activationId`, if the reply was started for it */
    contextFor: (activationId: number) =>
      reply.value?.activationId === activationId ? reply.value.text : undefined,
    clear: () => {
      reply.value = null
    },
  }
})
