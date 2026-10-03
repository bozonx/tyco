import { getCurrentWindow } from '@tauri-apps/api/window'

import {
  createOverlayNavModel,
  type OverlayNavOptions,
} from '../lib/modals/overlay-nav'
import { appNavigation } from '../lib/navigation/navigation'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useWriterInputStore } from '../stores/writerInput'
import { useI18n } from './useI18n'

export function useOverlayNav(options?: () => OverlayNavOptions) {
  const menuModalsStore = useMenuModalsStore()
  const ipcStore = useIpcStore()
  const writerInputStore = useWriterInputStore()
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

  const closeWindow = () => {
    menuModalsStore.cancelPending()
    menuModalsStore.closeAll()
    try {
      if (isQuickWindow()) {
        if (ipcStore.params?.mode === 'write') {
          writerInputStore.discard()
        }
        void ipcStore.callFunctionOrNotify('closeWindow')
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
        menuModalsStore.menuBreadcrumbs.length > 0,
      isQuickWindow,
      t,
      goBack,
      closeWindow,
    },
    options
  )
}
