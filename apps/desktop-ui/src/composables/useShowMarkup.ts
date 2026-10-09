import { computed } from 'vue'

import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'

/**
 * The editor view mode: the raw Markdown everywhere instead of the formatted
 * look. Kept in the local state, so it survives restarts.
 */
export function useShowMarkup() {
  const ipcStore = useIpcStore()
  const editorInputStore = useEditorInputStore()

  const showMarkup = computed(
    () => ipcStore.params.localState?.editorShowMarkup === true
  )

  const toggleShowMarkup = (): void => {
    void ipcStore.patchLocalState({ editorShowMarkup: !showMarkup.value })
    editorInputStore.focus()
  }

  return { showMarkup, toggleShowMarkup }
}
