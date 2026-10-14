import { getDesktopWindow as getCurrentWindow } from '../lib/desktop/window'

import {
  createOverlayNavModel,
  type OverlayNavOptions,
} from '../lib/modals/overlay-nav'
import { appNavigation } from '../lib/navigation/navigation'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useQuickInputStore } from '../stores/quick-input'
import { useI18n } from './use-i18n'

export function useOverlayNav(options?: () => OverlayNavOptions) {
  const menuModalsStore = useMenuModalsStore()
  const ipcStore = useIpcStore()
  const quickInputStore = useQuickInputStore()
  const { t } = useI18n()

  const isQuickWindow = () => {
    try {
      return getCurrentWindow().label === 'quick'
    } catch {
      return false
    }
  }

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
        if (ipcStore.desktopState?.mode === 'write') {
          quickInputStore.discard()
        }
        void ipcStore.callFunctionOrNotify('hideWindow')
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
