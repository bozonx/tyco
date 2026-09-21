import { defineStore } from 'pinia'
import { computed } from 'vue'

import { useCallAi } from '../composables/useCallAi'
import { useCallApi } from '../composables/useCallApi'
import useToast from '../composables/useToast'
import {
  type ActionItem,
  createActionMenuStoreModel,
} from '../lib/action-menu/action-menu-store'
import { useChatStore } from './chat'
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
  const { correctText } = useCallAi()
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
    startCorrection: async (text: string) => {
      const sourceId = await historyStore.saveSource(text, 'correction')
      menuModalsStore.setPendingModal({ correction: true })
      const newText = await correctText(text)
      void historyStore.saveSourceResult(sourceId, newText)
      menuModalsStore.clearPendingModal()
      menuModalsStore.nextModal(MenuModals.CORRECTION, {
        oldText: text,
        newText,
      })
    },
    startChatWithAttachment: (text: string) => {
      chatStore.startChat({ attachments: [text] })
    },
    showToast: (message, type) => {
      toast(message, type)
    },
    minCorrectionLength: () => appConfig.value.minCorrectionLength,
  })
})
