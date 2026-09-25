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
      const controller = new AbortController()
      menuModalsStore.setPendingModal({
        correction: true,
        onCancel: () => controller.abort(),
      })
      try {
        const newText = await correctText(text, { signal: controller.signal })
        if (controller.signal.aborted) return
        // a cancelled correction leaves no trace in the history
        const sourceId = await historyStore.saveSource(text, 'correction')
        await historyStore.saveSourceResult(sourceId, newText).catch(() => {
          toast('history.operationFailed', 'error')
        })
        menuModalsStore.nextModal(MenuModals.CORRECTION, {
          oldText: text,
          newText,
        })
      } catch {
        // The request layer already reported the actionable error.
      } finally {
        menuModalsStore.clearPendingModal()
      }
    },
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
