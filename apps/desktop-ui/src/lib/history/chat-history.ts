import { ref } from 'vue'
import type { Chat, ChatSummary } from '@tyco/shared'
import type { HistoryApi } from './history-call'
import {
  type ChatSessionStorageDriver,
  createIpcChatSessionStorageDriver,
  isChatSessionStorageDriver,
} from '../chat/chat-session-storage'

export function createChatHistoryModel(
  storage: ChatSessionStorageDriver | HistoryApi
) {
  const driver: ChatSessionStorageDriver = isChatSessionStorageDriver(storage)
    ? storage
    : createIpcChatSessionStorageDriver(storage)

  const chatHistory = ref<ChatSummary[]>([])

  // bumped by every load and change of the chat list, so that a list read
  // before a change never lands after it
  let chatListVersion = 0

  const loadChatHistory = async (): Promise<void> => {
    const version = ++chatListVersion
    const loadedHistory = await driver.listChats()
    if (version === chatListVersion) chatHistory.value = loadedHistory || []
  }

  /** The chat is stored; a list that failed to reload is refreshed next time */
  const refreshChatHistory = () => loadChatHistory().catch(() => {})

  const loadChat = async (id: string): Promise<Chat | null> => {
    const loadedChat = await driver.getChat(id)
    return loadedChat || null
  }

  const saveChat = async (chat: Chat) => {
    await driver.saveChat(chat)
    await refreshChatHistory()
  }

  /** Gives a chat another title, keeping its messages and its place */
  const renameChat = async (id: string, title: string) => {
    await driver.renameChat(id, title)
    chatListVersion += 1
    chatHistory.value = chatHistory.value.map((item) =>
      item.id === id ? { ...item, title } : item
    )
  }

  /** Ids of the chats whose title or messages contain the query */
  const searchChats = async (query: string): Promise<string[]> => {
    return driver.searchChats ? (await driver.searchChats(query)) || [] : []
  }

  const deleteChat = async (id: string): Promise<Chat | null> => {
    const removed = await driver.deleteChat(id)
    chatListVersion += 1
    chatHistory.value = chatHistory.value.filter((item) => item.id !== id)

    return removed
  }

  const restoreChatItem = async (item: Chat): Promise<void> => {
    await driver.saveChat(item)
    await refreshChatHistory()
  }

  const clearChats = async (): Promise<void> => {
    if (driver.clearChats) {
      await driver.clearChats()
    }
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
