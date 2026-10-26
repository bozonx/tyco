import { onMounted, onUnmounted } from 'vue'

import { shortcutLetter } from '../lib/editor/history-keys'

export function usePreviewModeShortcut(cycle: () => void) {
  function handleKeyDown(event: KeyboardEvent) {
    if (
      // Alt+D types ∂ on macOS, and texts name Ctrl as Cmd there
      shortcutLetter(event) === 'd' &&
      (event.ctrlKey || event.metaKey || event.altKey) &&
      !event.shiftKey
    ) {
      event.preventDefault()
      cycle()
    }
  }
  onMounted(() => window.addEventListener('keydown', handleKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))
}
