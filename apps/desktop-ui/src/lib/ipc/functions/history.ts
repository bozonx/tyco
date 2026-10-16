import type { Chat, EditorHistoryEntry, EditorHistoryItem } from '@tyco/shared'

// Without a profile id the chat functions work on the chats of "Ask AI"
export interface HistoryFunctions {
  getEditorHistory: { args: [] }
  listChats: { args: [profileId?: string] }
  getChat: { args: [id: string, profileId?: string] }
  saveEditorHistory: { args: [entry: EditorHistoryEntry] }
  setEditorHistoryResult: { args: [id: string, result: string] }
  restoreEditorHistoryItem: { args: [item: EditorHistoryItem] }
  saveChat: { args: [chat: Chat, profileId?: string] }
  renameChat: { args: [id: string, title: string, profileId?: string] }
  searchChats: { args: [query: string, profileId?: string] }
  removeFromEditorHistory: { args: [id: string] }
  deleteChat: { args: [id: string, profileId?: string] }
  clearEditorHistory: { args: [] }
  clearChats: { args: [profileId?: string] }
}
