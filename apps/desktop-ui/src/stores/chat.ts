import { defineStore } from 'pinia'

import { useCallAi } from '../composables/useCallAi'
import useToast from '../composables/useToast'
import { createChatStoreModel } from '../lib/chat/chat-store'
import { translate } from '../lib/i18n'
import { appNavigation } from '../lib/navigation/navigation'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { makeUniqId } from '@/lib/squidlet-lib-local'

export const useChatStore = defineStore('chat', () => {
  const { toast } = useToast()
  const { sendChatMessage, saveLocalState } = useCallAi()
  const ipcStore = useIpcStore()
  const historyStore = useHistoryStore()

  return createChatStoreModel({
    sendChatMessage,
    saveChatHistory: (item) => {
      void historyStore.saveChatHistory(item)
    },
    loadChatHistoryItem: (id) => historyStore.loadChat(id),
    navigateTo: (path) => appNavigation.push(path),
    notifyError: (message) => {
      toast(message, 'error')
    },
    emptyMessageError: () => translate('toast.textNotSelected'),
    chatNotFoundError: () => translate('history.empty'),
    createId: () => makeUniqId(8),
    nowIso: () => new Date().toISOString(),
    saveLocalState: async (patch) => {
      await saveLocalState(patch)
    },
    getLastChatId: () => ipcStore.params.localState?.lastChatId,
  })
})
