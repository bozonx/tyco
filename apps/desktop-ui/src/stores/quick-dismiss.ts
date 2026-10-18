import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * Screens that must survive a focus loss of the quick window (a dictation in
 * progress) hold it open while they need it
 */
export const useQuickDismissStore = defineStore('quickDismiss', () => {
  const holdCount = ref(0)

  /** Returns the release function; releasing twice is harmless. */
  const hold = (): (() => void) => {
    holdCount.value += 1
    let released = false

    return () => {
      if (released) return
      released = true
      holdCount.value -= 1
    }
  }

  const isHeld = computed(() => holdCount.value > 0)

  return { hold, isHeld }
})
