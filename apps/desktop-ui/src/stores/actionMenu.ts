import { defineStore } from 'pinia'
import { computed } from 'vue'

import { useCallApi } from '../composables/useCallApi'
import {
  type ActionItem,
  createActionMenuStoreModel,
} from '../lib/action-menu/action-menu-store'
import { useChatStore } from './chat'
import { useCommandRunnerDependencies } from './commands'
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
  const chatStore = useChatStore()

  return createActionMenuStoreModel({
    typeIntoWindowAndClose,
    putIntoClipboardAndClose: async (text: string) => {
      await ipcStore.callFunctionOrNotify('putIntoClipboardAndClose', [text])
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
    startCorrection: (text: string, extra?: Record<string, unknown>) =>
      // the result replaces the text in the editor as well
      correctionStore.start(text, { toEditorVisible: true, ...extra }),
    startChatWithAttachment: (text: string) => {
      menuModalsStore.closeAll()
      void chatStore.attachToChat(text)
    },
    minCorrectionLength: () => appConfig.value.minCorrectionLength,
    mainActionRegistrations: () =>
      ipcStore.params.userConfig.mainActionRegistrations,
    mainActions: () => ipcStore.params.userConfig.mainActions,
    commands: () => ipcStore.params.userConfig.commands,
    ...useCommandRunnerDependencies(),
  })
})
