import { defineStore } from 'pinia'

import { createQuickPanelModel } from '../lib/quick-panel/quick-panel'
import { useEditorInputStore } from './editorInput'
import { MenuModals, useMenuModalsStore } from './menuModals'
import { useNavPanelStore } from './navPanel'

export const useQuickPanelStore = defineStore('quickPanel', () => {
  const editorInputStore = useEditorInputStore()
  const menuModalsStore = useMenuModalsStore()
  const navPanelStore = useNavPanelStore()

  return createQuickPanelModel({
    focusInput: () => {
      editorInputStore.focus()
    },
    applyNavParams: () => {
      navPanelStore.resetNavParams({
        escBtnLabelKey: 'nav.actions',
        escBtnAction: () => {
          menuModalsStore.nextModal(MenuModals.INSERT, {
            text: editorInputStore.value,
          })
        },
      })
    },
  })
})
