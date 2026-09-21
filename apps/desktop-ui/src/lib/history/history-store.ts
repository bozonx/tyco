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
  // writes still on their way: a load must not overtake them, otherwise the
  // text saved on the way to the history page would be missing from it
  const pendingWrites = new Set<Promise<unknown>>()

  const track = <T>(write: Promise<T>): Promise<T> => {
    pendingWrites.add(write)
    void write.finally(() => pendingWrites.delete(write)).catch(() => {})

    return write
  }

  const loadEditorHistory = async (): Promise<void> => {
    await Promise.allSettled([...pendingWrites])

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

  /** Resolves to the id of the stored entry, null when nothing was stored. */
  const saveEditorHistory = async (
    entry: EditorHistoryEntry
  ): Promise<string | null> => {
    if (!entry.text.trim()) return null

    const saved = await track(
      historyApi.callFunction('saveEditorHistory', [entry])
    )

    return typeof saved?.result === 'string' ? saved.result : null
  }

  /** The text is leaving the app: inserted into a window or copied. */
  const saveOutput = (text: string) =>
    saveEditorHistory({ text, kind: 'output' })

  /**
   * Unsent text that is leaving the editor or may not survive a quit.
   * `replaceId` is the previous draft of the same editing session.
   */
  const saveDraft = (text: string, replaceId?: string) =>
    saveEditorHistory(
      replaceId ? { text, kind: 'draft', replaceId } : { text, kind: 'draft' }
    )

  /** The text is about to be replaced by the result of an AI operation. */
  const saveSource = (text: string, operation: EditorHistoryOperation) =>
    saveEditorHistory({ text, kind: 'source', operation })

  /** Remembers what the AI made of the `source` entry `id`. */
  const saveSourceResult = async (
    id: string | null,
    result: string
  ): Promise<void> => {
    if (!id) return

    await track(historyApi.callFunction('setEditorHistoryResult', [id, result]))
  }

  const saveChatHistory = async (chatHistoryItem: ChatHistoryItem) => {
    await historyApi.callFunction('saveChatHistory', [chatHistoryItem])
    await loadChatHistory()
  }

  /** Resolves to the removed entry, so that the removal can be undone. */
  const removeFromEditorHistory = async (
    id: string
  ): Promise<EditorHistoryItem | null> => {
    const removed = editorHistory.value.find((item) => item.id === id) ?? null

    await historyApi.callFunction('removeFromEditorHistory', [id])
    editorHistory.value = editorHistory.value.filter((item) => item.id !== id)

    return removed
  }

  /** Puts a removed entry back to its place. */
  const restoreEditorItem = async (item: EditorHistoryItem): Promise<void> => {
    await track(historyApi.callFunction('restoreEditorHistoryItem', [item]))
    await loadEditorHistory()
  }

  const removeFromChatHistory = async (id: string): Promise<void> => {
    await historyApi.callFunction('removeFromChatHistory', [id])
    chatHistory.value = chatHistory.value.filter((item) => item.id !== id)
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
    saveEditorHistory,
    saveOutput,
    saveDraft,
    saveSource,
    saveSourceResult,
    saveChatHistory,
    removeFromEditorHistory,
    restoreEditorItem,
    removeFromChatHistory,
    clearEditorHistory,
    clearChatHistory,
  }
}
