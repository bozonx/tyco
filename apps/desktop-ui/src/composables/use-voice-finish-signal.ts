import { computed, onMounted, onUnmounted } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import { useGlobalHotkeysStore } from '../stores/global-hotkeys'
import { useIpcStore } from '../stores/ipc'
import { DESKTOP_EVENTS } from '@tyco/shared'

/**
 * Confirms a voice input opened by an activation when that activation comes
 * again: its hotkey, D-Bus call or `tyco-ctl` call then does what Space and
 * Enter do. Returns the label of the hotkey for the button it presses; both are
 * off while `mode` names no activation mode.
 */
export function useVoiceFinishSignal(
  mode: () => string | undefined,
  confirm: () => void
) {
  const ipc = useIpcStore()
  const hotkeys = useGlobalHotkeysStore()
  let unlisten: (() => void) | undefined
  let unmounted = false

  onMounted(() => {
    void hotkeys.load()
    void desktopClient
      .listen(DESKTOP_EVENTS.VOICE_FINISH, (activationId) => {
        if (
          mode() &&
          activationId === ipc.desktopState.activationId &&
          ipc.desktopState.isWindowShown
        )
          confirm()
      })
      .then((stop) => {
        if (unmounted) stop()
        else unlisten = stop
      })
      .catch(() => undefined)
  })
  onUnmounted(() => {
    unmounted = true
    unlisten?.()
  })

  return computed(() => {
    const activationMode = mode()
    return activationMode ? hotkeys.shortcutLabel(activationMode) : ''
  })
}
