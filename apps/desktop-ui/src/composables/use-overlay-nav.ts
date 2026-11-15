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
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useI18n } from './use-i18n'

export function useOverlayNav(options?: () => OverlayNavOptions) {
  const menuModalsStore = useMenuModalsStore()
  const desktopStore = useDesktopStore()
  const editorInputStore = useEditorInputStore()
  const closeWindowStore = useCloseWindowStore()
  const { t } = useI18n()

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
        menuModalsStore.currentModal !== MenuModals.NONE &&
        (!isAtRoot() || !isQuickWindow()),
      isQuickWindow,
      t,
      goBack,
      hideWindow,
      closeAll,
    },
    () => ({
      ...options?.(),
      ...(!isQuickWindow() ? { escMode: 'back' as const } : {}),
    })
  )
  return { ...nav, isAtRoot }
}
