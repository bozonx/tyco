import { isQuickWindow } from '../lib/desktop/window'

import {
  createOverlayNavModel,
  type OverlayNavOptions,
} from '../lib/modals/overlay-nav'
import { isMenuRootMode } from '../lib/navigation/routes'
import { appNavigation } from '../navigation'
import { useCloseWindowStore } from '../stores/close-window'
import { useDesktopStore } from '../stores/desktop'
import { useEditorInputStore } from '../stores/editor-input'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useI18n } from './use-i18n'

export function useOverlayNav(options?: () => OverlayNavOptions) {
  const menuModalsStore = useMenuModalsStore()
  const desktopStore = useDesktopStore()
  const editorInputStore = useEditorInputStore()
  const closeWindowStore = useCloseWindowStore()
  const ipcStore = useIpcStore()
  const { t } = useI18n()

  const isFromDialog = () =>
    desktopStore.desktopState?.actionOrigin === 'dialog'

  /** A single step over the menu view of its quick window mode */
  const isOverModeMenu = () =>
    isQuickWindow() &&
    menuModalsStore.menuBreadcrumbs.length === 1 &&
    !menuModalsStore.isScenarioRoot &&
    isMenuRootMode(desktopStore.desktopState?.mode ?? null)

  /** No step to return to: Esc closes, Other actions may switch scenarios */
  const isAtRoot = () =>
    menuModalsStore.menuBreadcrumbs.length <= 1 && !isOverModeMenu()

  const goBack = () => {
    if (menuModalsStore.menuBreadcrumbs.length > 1) {
      menuModalsStore.back()
    } else if (isFromDialog() && isAtRoot()) {
      menuModalsStore.cancelPending()
      menuModalsStore.closeAll()
      if (isQuickWindow()) {
        void ipcStore.callOrNotify('activate_mode', { mode: 'dialog' })
      } else {
        void appNavigation.goToDialog()
      }
    } else if (!isQuickWindow()) {
      menuModalsStore.cancelPending()
      menuModalsStore.closeAll()
      void appNavigation.goToEditor()
      editorInputStore.requestFocus()
    } else {
      menuModalsStore.back()
    }
  }

  /** Esc at the root: the quick window closes, the main one shows the editor */
  const hideWindow = () => {
    if (isFromDialog()) {
      menuModalsStore.cancelPending()
      menuModalsStore.closeAll()
      if (isQuickWindow()) {
        void ipcStore.callOrNotify('activate_mode', { mode: 'dialog' })
      } else {
        void appNavigation.goToDialog()
      }
      return
    }
    if (isQuickWindow()) {
      closeWindowStore.closeAll()
      return
    }
    menuModalsStore.cancelPending()
    menuModalsStore.closeAll()
    void appNavigation.goToEditor()
  }

  const closeAll = () => closeWindowStore.closeAll()

  const nav = createOverlayNavModel(
    {
      currentModal: () => menuModalsStore.currentModal,
      canGoBack: () =>
        (isFromDialog() && isAtRoot()) ||
        (menuModalsStore.currentModal !== MenuModals.NONE &&
          (!isAtRoot() || !isQuickWindow())),
      isQuickWindow,
      t,
      goBack,
      hideWindow,
      closeAll,
    },
    () => ({
      ...options?.(),
      ...(!isQuickWindow() || isFromDialog()
        ? { escMode: 'back' as const }
        : {}),
    })
  )
  return { ...nav, isAtRoot }
}
