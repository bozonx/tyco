import type { ChatHistoryItem } from '@shared'
import { ref } from 'vue'

export interface HistoryApi {
  callFunction: (functionName: string, args?: unknown[]) => Promise<{ result?: unknown }>
}

export function createHistoryStoreModel(historyApi: HistoryApi) {
  const editorHistory = ref<string[]>([])
  const transformHistory = ref<string[]>([])
  const chatHistory = ref<ChatHistoryItem[]>([])

  const loadEditorHistory = async (): Promise<void> => {
    const loadedHistory = await historyApi.callFunction('getEditorHistory', [])
    editorHistory.value = (loadedHistory.result as string[]) || []
  }

  const loadTransformHistory = async (): Promise<void> => {
    const loadedHistory = await historyApi.callFunction('getTransformHistory', [])
    transformHistory.value = (loadedHistory.result as string[]) || []
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

  const saveEditorHistory = async (value: string) => {
    await historyApi.callFunction('saveEditorHistory', [value])
  }

  const saveTransformHistory = async (value: string) => {
    await historyApi.callFunction('saveTransformHistory', [value])
  }

  const saveChatHistory = async (chatHistoryItem: ChatHistoryItem) => {
    await historyApi.callFunction('saveChatHistory', [chatHistoryItem])
    await loadChatHistory()
  }

  const removeFromEditorHistory = async (value: string): Promise<void> => {
    await historyApi.callFunction('removeFromEditorHistory', [value])
    editorHistory.value = editorHistory.value.filter((item) => item !== value)
  }

  const removeFromTransformHistory = async (value: string): Promise<void> => {
    await historyApi.callFunction('removeFromTransformHistory', [value])
    transformHistory.value = transformHistory.value.filter((item) => item !== value)
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

  const clearTransformHistory = async (): Promise<void> => {
    await historyApi.callFunction('clearTransformHistory', [])
    transformHistory.value = []
  }

  const clearChatHistory = async (): Promise<void> => {
    await historyApi.callFunction('clearChatHistory', [])
    chatHistory.value = []
  }

  return {
    editorHistory,
    transformHistory,
    chatHistory,
    loadEditorHistory,
    loadTransformHistory,
    loadChatHistory,
    loadChat,
    saveMainInputTmp,
    saveEditorHistory,
    saveTransformHistory,
    saveChatHistory,
    removeFromEditorHistory,
    removeFromTransformHistory,
    removeFromChatHistory,
    clearMainInputTmp,
    clearEditorHistory,
    clearTransformHistory,
    clearChatHistory,
  }
}
