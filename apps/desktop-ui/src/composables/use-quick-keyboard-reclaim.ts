import { onMounted, onUnmounted } from 'vue'

import { useIpcStore } from '../stores/ipc'

/**
 * A click on the quick window should bring the keyboard along, but a compositor
 * or WebKitGTK sometimes leaves it elsewhere, and the keys of the panel stop
 * working. A press on the page without the focus asks the backend to take the
 * keyboard back.
 */
export function useQuickKeyboardReclaim() {
  const ipcStore = useIpcStore()
  const handlePointerDown = () => {
    if (document.hasFocus()) return
    void ipcStore.call('reclaim_quick_keyboard')
  }
  onMounted(() => {
    window.addEventListener('pointerdown', handlePointerDown, true)
  })
  onUnmounted(() => {
    window.removeEventListener('pointerdown', handlePointerDown, true)
  })
}
