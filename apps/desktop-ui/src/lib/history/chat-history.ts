import { ref } from 'vue'
import type { Chat, ChatSummary } from '@tyco/shared'
import type { HistoryApi } from './history-call'
import { createHistoryCall } from './history-call'

export function createChatHistoryModel(historyApi: HistoryApi) {
  const call = createHistoryCall(historyApi)

  const chatHistory = ref<ChatSummary[]>([])

  // bumped by every load and change of the chat list, so that a list read
  // before a change never lands after it
  let chatListVersion = 0

  const loadChatHistory = async (): Promise<void> => {
    const version = ++chatListVersion
    const loadedHistory = await call('listChats')
    if (version === chatListVersion) chatHistory.value = loadedHistory || []
  }

  /** The chat is stored; a list that failed to reload is refreshed next time */
  const refreshChatHistory = () => loadChatHistory().catch(() => {})

  const loadChat = async (id: string): Promise<Chat | null> => {
    const loadedChat = await call('getChat', [id])
    return loadedChat || null
  }

  const saveChat = async (chat: Chat) => {
    await call('saveChat', [chat])
    await refreshChatHistory()
  }

  /** Gives a chat another title, keeping its messages and its place */
  const renameChat = async (id: string, title: string) => {
    await call('renameChat', [id, title])
    chatListVersion += 1
    chatHistory.value = chatHistory.value.map((item) =>
      item.id === id ? { ...item, title } : item
    )
  }

  /** Ids of the chats whose title or messages contain the query */
  const searchChats = async (query: string): Promise<string[]> => {
    return (await call('searchChats', [query])) || []
  }

  const deleteChat = async (id: string): Promise<Chat | null> => {
    const removed = await loadChat(id)

    await call('deleteChat', [id])
    chatListVersion += 1
    chatHistory.value = chatHistory.value.filter((item) => item.id !== id)

    return removed
  }

  const restoreChatItem = async (item: Chat): Promise<void> => {
    await call('saveChat', [item])
    await refreshChatHistory()
  }

  const clearChats = async (): Promise<void> => {
    await call('clearChats')
    chatListVersion += 1
    chatHistory.value = []
  }
  return {
    chatHistory,
    loadChatHistory,
    loadChat,
    saveChat,
    renameChat,
    searchChats,
    deleteChat,
    restoreChatItem,
    clearChats,
  }
}
