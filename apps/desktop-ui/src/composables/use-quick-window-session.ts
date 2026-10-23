import { watch } from 'vue'

import { createQuickWindowSession } from '../lib/quick-panel/quick-window-session'
import { useCommandLauncherStore } from '../stores/command-launcher'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useQuickDismissStore } from '../stores/quick-dismiss'
import { useQuickInputStore } from '../stores/quick-input'

/**
 * The session rules of the quick window, for the overlay that renders it.
 * `onActivation` runs on each new activation, after the old work is dropped
 */
export function useQuickWindowSession(
  options: { onActivation?: () => void } = {}
) {
  const desktopStore = useDesktopStore()
  const ipcStore = useIpcStore()
  const menuModalsStore = useMenuModalsStore()
  const quickInputStore = useQuickInputStore()
  const quickDismissStore = useQuickDismissStore()
  const commandLauncherStore = useCommandLauncherStore()

  const session = createQuickWindowSession({
    mode: () => desktopStore.desktopState.mode || 'quickInput',
    isWindowShown: () => Boolean(desktopStore.desktopState.isWindowShown),
    isLauncherPastList: () => commandLauncherStore.stage.kind !== 'list',
    hasModal: () => menuModalsStore.currentModal !== MenuModals.NONE,
    hasPendingModal: () => Boolean(menuModalsStore.pendingModal),
    isHideOnBlurEnabled: () =>
      desktopStore.userConfig?.quickWindow?.isHiddenOnBlur !== false,
    isDismissHeld: () => quickDismissStore.isHeld,
    markInputDismissed: quickInputStore.markDismissed,
    cancelAndCloseModals: menuModalsStore.cancelAndCloseAll,
    // a failed dismissal leaves the window shown, which tells enough
    dismissWindow: () => void ipcStore.call('hide_quick_window_on_blur'),
  })

  watch(
    () => desktopStore.desktopState.isWindowShown,
    (isShown) => {
      if (!isShown) session.endActivation()
    }
  )
  watch(
    () => desktopStore.desktopState.activationId,
    () => {
      session.endActivation()
      options.onActivation?.()
    },
    { flush: 'sync' }
  )

  return session
}
