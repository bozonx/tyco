import { isQuickWindow } from '../lib/desktop/window'

import {
  createOverlayNavModel,
  type OverlayNavOptions,
} from '../lib/modals/overlay-nav'
import { appNavigation } from '../navigation'
import { useDesktopStore } from '../stores/desktop'
import { useEditorInputStore } from '../stores/editor-input'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useQuickInputStore } from '../stores/quick-input'
import { useVoiceResultStore } from '../stores/voice-result'
import { useI18n } from './use-i18n'

export function useOverlayNav(options?: () => OverlayNavOptions) {
  const menuModalsStore = useMenuModalsStore()
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const editorInputStore = useEditorInputStore()
  const quickInputStore = useQuickInputStore()
  const voiceResultStore = useVoiceResultStore()
  const { t } = useI18n()

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

  const hideWindow = () => {
    menuModalsStore.cancelPending()
    menuModalsStore.closeAll()
    try {
      if (isQuickWindow()) {
        // Esc drops the text on purpose; it stays only in the history
        const mode = desktopStore.desktopState?.mode
        if (mode === 'quickInput') quickInputStore.discard()
        if (mode === 'voice') voiceResultStore.step.resetResult()
        void ipcStore.callOrNotify('hide_window')
      } else {
        void appNavigation.goToEditor()
      }
    } catch {
      // Dev mode fallback
    }
  }

  const closeAll = () => {
    menuModalsStore.cancelPending()
    menuModalsStore.closeAll()
    try {
      if (isQuickWindow()) {
        const mode = desktopStore.desktopState?.mode
        if (mode === 'quickInput') quickInputStore.discard()
        if (mode === 'voice') voiceResultStore.step.resetResult()
        void ipcStore.callOrNotify('hide_window')
      } else {
        void ipcStore.callOrNotify('hide_window')
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
        (menuModalsStore.menuBreadcrumbs.length > 1 || !isQuickWindow()),
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
}
