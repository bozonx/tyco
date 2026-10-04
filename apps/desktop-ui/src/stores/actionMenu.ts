import { defineStore } from 'pinia'
import { computed } from 'vue'

import { useCallApi } from '../composables/useCallApi'
import useToast from '../composables/useToast'
import {
  type ActionItem,
  createActionMenuStoreModel,
} from '../lib/action-menu/action-menu-store'
import { executeWebhookAction } from '../lib/action-menu/custom-actions'
import { createTauriFetch } from '../lib/net/tauri-fetch'
import { tauriNetIpc } from '../lib/net/tauri-net'
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
      void chatStore.attachToChat(text)
    },
    showToast: (message, type) => {
      toast(message, type)
    },
    minCorrectionLength: () => appConfig.value.minCorrectionLength,
    mainActionRegistrations: () =>
      ipcStore.params.userConfig.mainActionRegistrations,
    mainActions: () => ipcStore.params.userConfig.mainActions,
    closeWindow: () => {
      void ipcStore.callFunctionOrNotify('closeWindow', [])
    },
    executeScriptAction: async (
      name,
      command,
      text,
      logOutput,
      executionType,
      args,
      workingDir
    ) => {
      const res = await ipcStore.callFunctionOrNotify('executeScriptAction', [
        name,
        command,
        text,
        Boolean(logOutput),
        executionType,
        args,
        workingDir,
      ])
      if (res.success && res.result) {
        return res.result
      }
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: res.error ?? '',
      }
    },
    logCustomAction: async (name, actionType, details) => {
      await ipcStore.callFunction('logCustomAction', [
        name,
        actionType,
        details,
      ])
    },
    executeWebhookAction: async (action, text) => {
      const fetchFn = createTauriFetch(tauriNetIpc)
      await executeWebhookAction(
        action,
        text,
        fetchFn,
        async (name, type, details) => {
          await ipcStore.callFunction('logCustomAction', [name, type, details])
        }
      )
    },
  })
})
