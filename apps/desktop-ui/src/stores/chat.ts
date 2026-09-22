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
      void historyStore.saveChatHistory(item).catch(() => {
        toast(translate('history.operationFailed'), 'error')
      })
    },
    loadChatHistoryItem: (id) => historyStore.loadChat(id),
    navigateTo: (path) => appNavigation.push(path),
    notifyError: (message) => {
      toast(message, 'error')
    },
    emptyMessageError: () => translate('toast.textNotSelected'),
    chatNotFoundError: () => translate('history.empty'),
    messageTooLongError: () => translate('llmErrors.contextLength'),
    createId: () => makeUniqId(8),
    nowIso: () => new Date().toISOString(),
    saveLocalState: async (patch) => {
      await saveLocalState(patch)
    },
    getLastChatId: () => ipcStore.params.localState?.lastChatId,
    getContextBudgetCharacters: () => {
      const llm = ipcStore.params.userConfig.llm
      const modelId = llm.tasks.chat[0]
      const contextSize =
        llm.models.find((model) => model.id === modelId)?.contextSize ?? 128_000
      // Reserve roughly 25% for instructions and output; 3 chars/token is
      // deliberately conservative for multilingual text.
      return Math.max(4_000, Math.floor(contextSize * 3 * 0.75))
    },
  })
})
