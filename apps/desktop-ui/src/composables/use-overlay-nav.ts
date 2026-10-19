import { isQuickWindow } from '../lib/desktop/window'

import {
  createOverlayNavModel,
  type OverlayNavOptions,
} from '../lib/modals/overlay-nav'
import { appNavigation } from '../lib/navigation/navigation'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useQuickInputStore } from '../stores/quick-input'
import { useI18n } from './use-i18n'

export function useOverlayNav(options?: () => OverlayNavOptions) {
  const menuModalsStore = useMenuModalsStore()
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const quickInputStore = useQuickInputStore()
  const { t } = useI18n()

  const goBack = () => {
    if (menuModalsStore.currentModal !== MenuModals.NONE) {
      menuModalsStore.back()
    }
  }

  const hideWindow = () => {
    menuModalsStore.cancelPending()
    menuModalsStore.closeAll()
    try {
      if (isQuickWindow()) {
        if (desktopStore.desktopState?.mode === 'write') {
          quickInputStore.discard()
        }
        void ipcStore.callOrNotify('hide_window')
      } else {
        void appNavigation.goToEditor()
      }
    } catch {
      // Dev mode fallback
    }
  }

  return createOverlayNavModel(
    {
      currentModal: () => menuModalsStore.currentModal,
      canGoBack: () =>
        menuModalsStore.currentModal !== MenuModals.NONE &&
        menuModalsStore.menuBreadcrumbs.length > 1,
      isQuickWindow,
      t,
      goBack,
      hideWindow,
    },
    options
  )
}
