import { ref } from 'vue'

/** Whether the editor shows the Markdown source instead of the formatted text */
export function createMarkupMode(focus: () => void) {
  const showMarkup = ref(false)
  const setShowMarkup = (show: boolean): void => {
    if (show === showMarkup.value) return
    showMarkup.value = show
    focus()
  }
  const toggleShowMarkup = (): void => setShowMarkup(!showMarkup.value)
  return { showMarkup, setShowMarkup, toggleShowMarkup }
}
