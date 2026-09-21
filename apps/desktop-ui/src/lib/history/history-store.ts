import type {
  ChatHistoryItem,
  EditorHistoryEntry,
  EditorHistoryItem,
  EditorHistoryOperation,
} from '@tyco/shared'
import { ref } from 'vue'

export interface HistoryApi {
  callFunction: (
    functionName: string,
    args?: unknown[]
  ) => Promise<{ result?: unknown }>
}

export function createHistoryStoreModel(historyApi: HistoryApi) {
  const editorHistory = ref<EditorHistoryItem[]>([])
  const chatHistory = ref<ChatHistoryItem[]>([])

  const loadEditorHistory = async (): Promise<void> => {
    const loadedHistory = await historyApi.callFunction('getEditorHistory', [])
    editorHistory.value = (loadedHistory.result as EditorHistoryItem[]) || []
  }

  const loadChatHistory = async (): Promise<void> => {
    const loadedHistory = await historyApi.callFunction('getChatHistory', [])
    chatHistory.value = (loadedHistory.result as ChatHistoryItem[]) || []
  }

  const loadChat = async (id: string): Promise<ChatHistoryItem | null> => {
    const loadedChat = await historyApi.callFunction('getChat', [id])
    return (loadedChat.result as ChatHistoryItem | null) || null
  }

  const saveMainInputTmp = async (value: string) => {
    await historyApi.callFunction('saveMainInputTmp', [value])
  }

  const saveEditorHistory = async (entry: EditorHistoryEntry) => {
    if (!entry.text.trim()) return

    await historyApi.callFunction('saveEditorHistory', [entry])
  }

  /** The text is leaving the app: inserted into a window or copied. */
  const saveOutput = (text: string) =>
    saveEditorHistory({ text, kind: 'output' })

  /** The text stays in the editor while the user moves away from it. */
  const saveDraft = (text: string) => saveEditorHistory({ text, kind: 'draft' })

  /** The text is about to be replaced by the result of an AI operation. */
  const saveSource = (text: string, operation: EditorHistoryOperation) =>
    saveEditorHistory({ text, kind: 'source', operation })

  const saveChatHistory = async (chatHistoryItem: ChatHistoryItem) => {
    await historyApi.callFunction('saveChatHistory', [chatHistoryItem])
    await loadChatHistory()
  }

  const removeFromEditorHistory = async (id: string): Promise<void> => {
    await historyApi.callFunction('removeFromEditorHistory', [id])
    editorHistory.value = editorHistory.value.filter((item) => item.id !== id)
  }

  const removeFromChatHistory = async (id: string): Promise<void> => {
    await historyApi.callFunction('removeFromChatHistory', [id])
    chatHistory.value = chatHistory.value.filter((item) => item.id !== id)
  }

  const clearMainInputTmp = async (): Promise<void> => {
    await historyApi.callFunction('clearMainInputTmp', [])
  }

  const clearEditorHistory = async (): Promise<void> => {
    await historyApi.callFunction('clearEditorHistory', [])
    editorHistory.value = []
  }

  const clearChatHistory = async (): Promise<void> => {
    await historyApi.callFunction('clearChatHistory', [])
    chatHistory.value = []
  }

  return {
    editorHistory,
    chatHistory,
    loadEditorHistory,
    loadChatHistory,
    loadChat,
    saveMainInputTmp,
    saveEditorHistory,
    saveOutput,
    saveDraft,
    saveSource,
    saveChatHistory,
    removeFromEditorHistory,
    removeFromChatHistory,
    clearMainInputTmp,
    clearEditorHistory,
    clearChatHistory,
  }
}
