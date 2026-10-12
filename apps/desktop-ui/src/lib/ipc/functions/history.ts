import type { Chat, EditorHistoryEntry, EditorHistoryItem } from '@tyco/shared'

export interface HistoryFunctions {
  getEditorHistory: { args: [] }
  listChats: { args: [] }
  getChat: { args: [id: string] }
  saveEditorHistory: { args: [entry: EditorHistoryEntry] }
  setEditorHistoryResult: { args: [id: string, result: string] }
  restoreEditorHistoryItem: { args: [item: EditorHistoryItem] }
  saveChat: { args: [chat: Chat] }
  renameChat: { args: [id: string, title: string] }
  searchChats: { args: [query: string] }
  removeFromEditorHistory: { args: [id: string] }
  deleteChat: { args: [id: string] }
  clearEditorHistory: { args: [] }
  clearChats: { args: [] }
}
