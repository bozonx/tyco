import { onMounted, onUnmounted } from 'vue'

export function usePreviewModeShortcut(cycle: () => void) {
  function handleKeyDown(event: KeyboardEvent) {
    if (
      event.key.toLowerCase() === 'd' &&
      (event.ctrlKey || event.altKey) &&
      !event.shiftKey
    ) {
      event.preventDefault()
      cycle()
    }
  }
  onMounted(() => window.addEventListener('keydown', handleKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))
}
