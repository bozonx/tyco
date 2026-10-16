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

/**
 * The chats of "Ask AI", or with `profileId` those of that profile; both live
 * behind the same history commands
 */
export function createIpcChatSessionStorageDriver(
  historyApi: HistoryApi,
  profileId?: string
): ChatSessionStorageDriver {
  const call = createHistoryCall(historyApi)
  // "Ask AI" calls carry no profile argument at all
  const scoped = <T extends unknown[]>(...args: T): [...T, string?] =>
    profileId ? [...args, profileId] : [...args]

  return {
    async listChats(): Promise<ChatSummary[]> {
      const result = await call('listChats', scoped())
      return result || []
    },
    async getChat(id: string): Promise<Chat | null> {
      const result = await call('getChat', scoped(id))
      return result || null
    },
    async saveChat(chat: Chat): Promise<void> {
      await call('saveChat', scoped(chat))
    },
    async renameChat(id: string, title: string): Promise<void> {
      await call('renameChat', scoped(id, title))
    },
    async deleteChat(id: string): Promise<Chat | null> {
      const removed = await call('getChat', scoped(id))
      await call('deleteChat', scoped(id))
      return removed || null
    },
    async searchChats(query: string): Promise<string[]> {
      const result = await call('searchChats', scoped(query))
      return result || []
    },
    async clearChats(): Promise<void> {
      await call('clearChats', scoped())
    },
  }
}
