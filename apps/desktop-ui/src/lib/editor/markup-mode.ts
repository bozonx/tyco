import { ref } from 'vue'

/** Whether the editor shows the Markdown source instead of the formatted text */
export function createMarkupMode(focus: () => void) {
  const isMarkupShown = ref(false)
  const setShowMarkup = (show: boolean): void => {
    if (show === isMarkupShown.value) return
    isMarkupShown.value = show
    focus()
  }
  const toggleShowMarkup = (): void => setShowMarkup(!isMarkupShown.value)
  return { isMarkupShown, setShowMarkup, toggleShowMarkup }
}
