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
  const scope = profileId ? { profileId } : undefined

  return {
    async listChats(): Promise<ChatSummary[]> {
      const result = await call('list_chats', scope)
      return result || []
    },
    async getChat(id: string): Promise<Chat | null> {
      const result = await call('get_chat', { id, ...scope })
      return result || null
    },
    async saveChat(chat: Chat): Promise<void> {
      await call('save_chat', { chat, ...scope })
    },
    async renameChat(id: string, title: string): Promise<void> {
      await call('rename_chat', { id, title, ...scope })
    },
    async deleteChat(id: string): Promise<Chat | null> {
      const removed = await call('get_chat', { id, ...scope })
      await call('delete_chat', { id, ...scope })
      return removed || null
    },
    async searchChats(query: string): Promise<string[]> {
      const result = await call('search_chats', { query, ...scope })
      return result || []
    },
    async clearChats(): Promise<void> {
      await call('clear_chats', scope)
    },
  }
}
