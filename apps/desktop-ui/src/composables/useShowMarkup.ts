import { ref } from 'vue'

import { useEditorInputStore } from '../stores/editorInput'

/**
 * The editor view mode: the raw Markdown everywhere instead of the formatted
 * look. Not persisted: the editor opens formatted and returns to it once the
 * page is left (see `resetShowMarkup`).
 */
const showMarkup = ref(false)

/** Back to the formatted look, without moving the focus */
export function resetShowMarkup(): void {
  showMarkup.value = false
}

export function useShowMarkup() {
  const editorInputStore = useEditorInputStore()

  const setShowMarkup = (show: boolean): void => {
    if (show === showMarkup.value) return
    showMarkup.value = show
    editorInputStore.focus()
  }

  const toggleShowMarkup = (): void => setShowMarkup(!showMarkup.value)

  return { showMarkup, setShowMarkup, toggleShowMarkup }
}
