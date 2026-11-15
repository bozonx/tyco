import { defineStore } from 'pinia'

import { createCloseWindowModel } from '../lib/app/close-window'
import { isQuickWindow } from '../lib/desktop/window'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'
import { useMenuModalsStore } from './menu-modals'
import { useQuickInputStore } from './quick-input'
import { useVoiceResultStore } from './voice-result'

/** Shift+Esc and the close cross: cancel everything and hide the window */
export const useCloseWindowStore = defineStore('closeWindow', () => {
  const menuModalsStore = useMenuModalsStore()
  const desktopStore = useDesktopStore()
  const ipcStore = useIpcStore()
  const quickInputStore = useQuickInputStore()
  const voiceResultStore = useVoiceResultStore()

  return createCloseWindowModel({
    closeWindow: () => {
      menuModalsStore.cancelPending()
      menuModalsStore.closeAll()
      if (isQuickWindow()) {
        // closing drops the text on purpose; it stays only in the history
        const mode = desktopStore.desktopState?.mode
        if (mode === 'quickInput') quickInputStore.discard()
        if (mode === 'voice') voiceResultStore.step.resetResult()
      }
      void ipcStore.callOrNotify('hide_window')
    },
  })
})
