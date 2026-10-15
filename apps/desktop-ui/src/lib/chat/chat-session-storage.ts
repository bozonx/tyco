import type { Chat, ChatSummary } from '@tyco/shared'
import type { HistoryApi } from '../history/history-call'
import { createHistoryCall } from '../history/history-call'

export interface ChatSessionStorageDriver {
  listChats(): Promise<ChatSummary[]>
  getChat(id: string): Promise<Chat | null>
  saveChat(chat: Chat): Promise<void>
  renameChat(id: string, title: string): Promise<void>
  deleteChat(id: string): Promise<Chat | null>
  searchChats?(query: string): Promise<string[]>
  clearChats?(): Promise<void>
}

export function isChatSessionStorageDriver(
  value: unknown
): value is ChatSessionStorageDriver {
  return (
    typeof value === 'object' &&
    value !== null &&
    'listChats' in value &&
    typeof (value as ChatSessionStorageDriver).listChats === 'function' &&
    'getChat' in value &&
    'saveChat' in value &&
    'renameChat' in value &&
    'deleteChat' in value
  )
}

export function createIpcChatSessionStorageDriver(
  historyApi: HistoryApi
): ChatSessionStorageDriver {
  const call = createHistoryCall(historyApi)

  return {
    async listChats(): Promise<ChatSummary[]> {
      const result = await call('listChats')
      return result || []
    },
    async getChat(id: string): Promise<Chat | null> {
      const result = await call('getChat', [id])
      return result || null
    },
    async saveChat(chat: Chat): Promise<void> {
      await call('saveChat', [chat])
    },
    async renameChat(id: string, title: string): Promise<void> {
      await call('renameChat', [id, title])
    },
    async deleteChat(id: string): Promise<Chat | null> {
      const removed = await call('getChat', [id])
      await call('deleteChat', [id])
      return removed || null
    },
    async searchChats(query: string): Promise<string[]> {
      const result = await call('searchChats', [query])
      return result || []
    },
    async clearChats(): Promise<void> {
      await call('clearChats')
    },
  }
}
