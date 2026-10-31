import { computed, onMounted, onUnmounted } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import { useGlobalHotkeysStore } from '../stores/global-hotkeys'
import { useDesktopStore } from '../stores/desktop'
import { DESKTOP_EVENTS } from '@tyco/shared'

/**
 * Confirms a voice input opened by an activation when that activation comes
 * again: its hotkey, D-Bus call or `tyco-ctl` call then does what Space and
 * Enter do. Returns the label of the hotkey for the button it presses; both are
 * off while `mode` names no activation mode. `release` runs when the held
 * hotkey is let go in Push-to-Talk: it ends a recording, never starts one.
 */
export function useVoiceFinishSignal(
  mode: () => string | undefined,
  confirm: () => void,
  release?: () => void
) {
  const desktopStore = useDesktopStore()
  const hotkeys = useGlobalHotkeysStore()
  const unlisten: (() => void)[] = []
  let unmounted = false
  const isCurrent = (activationId: number) =>
    Boolean(mode()) &&
    activationId === desktopStore.desktopState.activationId &&
    desktopStore.desktopState.isWindowShown
  const keep = (stop: () => void) => {
    if (unmounted) stop()
    else unlisten.push(stop)
  }

  onMounted(() => {
    void hotkeys.load()
    void desktopClient
      .listen(DESKTOP_EVENTS.VOICE_FINISH, (activationId) => {
        if (isCurrent(activationId)) confirm()
      })
      .then(keep)
      .catch(() => undefined)
    if (release)
      void desktopClient
        .listen(DESKTOP_EVENTS.VOICE_RELEASE, (activationId) => {
          if (isCurrent(activationId)) release()
        })
        .then(keep)
        .catch(() => undefined)
  })
  onUnmounted(() => {
    unmounted = true
    for (const stop of unlisten.splice(0)) stop()
  })

  return computed(() => {
    const activationMode = mode()
    return activationMode ? hotkeys.shortcutLabel(activationMode) : ''
  })
}
