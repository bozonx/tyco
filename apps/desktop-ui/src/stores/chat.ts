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
    saveChatHistory: async (item) => {
      try {
        await historyStore.saveChatHistory(item)
      } catch (error) {
        toast(translate('history.operationFailed'), 'error')
        throw error
      }
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
      const assignedModels = llm.tasks.chat
        .map((id) => llm.models.find((model) => model.id === id))
        .filter((model) => model !== undefined)
      const contextSize = Math.min(
        ...assignedModels.map((model) => model.contextSize ?? 128_000)
      )
      // Reserve roughly 25% for instructions and output; 3 chars/token is
      // deliberately conservative for multilingual text.
      return Number.isFinite(contextSize)
        ? Math.max(4_000, Math.floor(contextSize * 3 * 0.75))
        : 4_000
    },
  })
})
