import { defineStore } from 'pinia'

import { createCloseWindowModel } from '../lib/app/close-window'
import { useDesktopStore } from './desktop'
import { useMenuModalsStore } from './menu-modals'
import { useQuickInputStore } from './quick-input'
import { useVoiceResultStore } from './voice-result'
import { useWindowStore } from './window'

/** Ctrl+Q and the close cross: cancel everything and hide the window */
export const useCloseWindowStore = defineStore('closeWindow', () => {
  const menuModalsStore = useMenuModalsStore()
  const desktopStore = useDesktopStore()
  const windowStore = useWindowStore()
  const quickInputStore = useQuickInputStore()
  const voiceResultStore = useVoiceResultStore()

  return createCloseWindowModel({
    closeWindow: () => {
      menuModalsStore.cancelPending()
      menuModalsStore.closeAll()
      // closing drops the text on purpose; it stays only in the history
      const mode = desktopStore.desktopState?.mode
      if (mode === 'quickInput') quickInputStore.discard()
      if (mode === 'voice') voiceResultStore.step.resetResult()
      void windowStore.hide()
    },
  })
})
