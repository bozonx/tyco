import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'

/** Switches the shown quick window between voice input and listening. */
export function useQuickModeSwitch() {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()

  return {
    canListen: () => Boolean(desktopStore.desktopState.canListen),
    /** The activation the window shows once it has switched */
    nextActivationId: () => desktopStore.desktopState.activationId + 1,
    switchTo: (mode: 'voice' | 'listen') =>
      ipcStore.call('switch_quick_mode', { mode }),
  }
}
