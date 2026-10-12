import { ref } from 'vue'

/** Shared within one editor application, reset when leaving the editor. */
export function createMarkupMode(focus: () => void) {
  const showMarkup = ref(false)
  const setShowMarkup = (show: boolean): void => {
    if (show === showMarkup.value) return
    showMarkup.value = show
    focus()
  }
  const toggleShowMarkup = (): void => setShowMarkup(!showMarkup.value)
  const resetShowMarkup = (): void => {
    showMarkup.value = false
  }
  return { showMarkup, setShowMarkup, toggleShowMarkup, resetShowMarkup }
}
