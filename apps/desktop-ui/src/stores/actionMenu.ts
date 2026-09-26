import { defineStore } from 'pinia'
import { computed } from 'vue'

import { useCallApi } from '../composables/useCallApi'
import useToast from '../composables/useToast'
import {
  type ActionItem,
  createActionMenuStoreModel,
} from '../lib/action-menu/action-menu-store'
import { useChatStore } from './chat'
import { useCorrectionStore } from './correction'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menuModals'

export type { ActionItem }

export const useActionMenuStore = defineStore('actionMenu', () => {
  const { typeIntoWindowAndClose } = useCallApi()
  const ipcStore = useIpcStore()
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const appConfig = computed(() => ipcStore.params.appConfig)
  const correctionStore = useCorrectionStore()
  const { toast } = useToast()
  const chatStore = useChatStore()

  return createActionMenuStoreModel({
    typeIntoWindowAndClose,
    putIntoClipboardAndClose: async (text: string) => {
      await ipcStore.callFunction('putIntoClipboardAndClose', [text])
    },
    saveOutput: async (text: string) => {
      await historyStore.saveOutput(text)
    },
    openAiTaskModal: (text: string) => {
      menuModalsStore.nextModal(MenuModals.AI_TASK, { text })
    },
    openTranslateModal: (text: string) => {
      menuModalsStore.nextModal(MenuModals.TRANSLATE, { text })
    },
    startCorrection: (text: string) =>
      // the result replaces the text in the editor as well
      correctionStore.start(text, { toEditorVisible: true }),
    startChatWithAttachment: (text: string) => {
      chatStore.startChat({ attachments: [text] })
    },
    showToast: (message, type) => {
      toast(message, type)
    },
    minCorrectionLength: () => appConfig.value.minCorrectionLength,
    mainActions: () => ipcStore.params.userConfig.mainActions,
  })
})
