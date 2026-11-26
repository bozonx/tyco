import { defineStore } from 'pinia'

import { clientLogger } from '../lib/logger'
import { createCloseWindowModel } from '../lib/app/close-window'
import { useActionMenuStore } from './action-menu'
import { useDesktopStore } from './desktop'
import { useDictationStore } from './dictation'
import { useMenuModalsStore } from './menu-modals'
import { useQuickInputStore } from './quick-input'
import { useVoiceResultStore } from './voice-result'
import { useWindowStore } from './window'

/**
 * Ctrl+W (close window) and Ctrl+Q (quit app): cancel everything and hide or
 * exit
 */
export const useCloseWindowStore = defineStore('closeWindow', () => {
  const menuModalsStore = useMenuModalsStore()
  const desktopStore = useDesktopStore()
  const windowStore = useWindowStore()
  const quickInputStore = useQuickInputStore()
  const voiceResultStore = useVoiceResultStore()
  const dictationStore = useDictationStore()
  const actionMenuStore = useActionMenuStore()

  return createCloseWindowModel({
    closeWindow: () => {
      menuModalsStore.cancelPending()
      menuModalsStore.closeAll()
      actionMenuStore.openPage(0)
      void dictationStore.cancelActive().catch((error: unknown) => {
        clientLogger.warn(
          `Could not cancel dictation on window close: ${String(error)}`,
          'stt'
        )
      })
      // closing drops the text on purpose; it stays only in the history
      const mode = desktopStore.desktopState?.mode
      if (mode === 'quickInput') quickInputStore.discard()
      if (mode === 'voice') voiceResultStore.step.resetResult()
      void windowStore.hide()
    },
    exitApp: () => {
      void windowStore.exitApp()
    },
  })
})
