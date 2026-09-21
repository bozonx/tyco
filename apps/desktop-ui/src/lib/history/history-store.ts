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
  ) => Promise<{ success?: boolean; error?: string; result?: unknown }>
}

export class HistoryOperationError extends Error {
  constructor(operation: string, message?: string) {
    super(message || `History operation failed: ${operation}`)
    this.name = 'HistoryOperationError'
  }
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

  const call = async (functionName: string, args: unknown[] = []) => {
    const response = await historyApi.callFunction(functionName, args)

    if (response.success === false) {
      throw new HistoryOperationError(functionName, response.error)
    }

    return response.result
  }

  const loadEditorHistory = async (): Promise<void> => {
    await Promise.allSettled([...pendingWrites])

    const loadedHistory = await call('getEditorHistory')
    editorHistory.value = (loadedHistory as EditorHistoryItem[]) || []
  }

  const loadChatHistory = async (): Promise<void> => {
    const loadedHistory = await call('getChatHistory')
    chatHistory.value = (loadedHistory as ChatHistoryItem[]) || []
  }

  const loadChat = async (id: string): Promise<ChatHistoryItem | null> => {
    const loadedChat = await call('getChat', [id])
    return (loadedChat as ChatHistoryItem | null) || null
  }

  /** Resolves to the id of the stored entry, null when nothing was stored. */
  const saveEditorHistory = async (
    entry: EditorHistoryEntry
  ): Promise<string | null> => {
    if (!entry.text.trim()) return null

    const saved = await track(call('saveEditorHistory', [entry]))

    return typeof saved === 'string' ? saved : null
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

    await track(call('setEditorHistoryResult', [id, result]))
  }

  const saveChatHistory = async (chatHistoryItem: ChatHistoryItem) => {
    await call('saveChatHistory', [chatHistoryItem])
    await loadChatHistory()
  }

  /** Resolves to the removed entry, so that the removal can be undone. */
  const removeFromEditorHistory = async (
    id: string
  ): Promise<EditorHistoryItem | null> => {
    const removed = editorHistory.value.find((item) => item.id === id) ?? null

    await call('removeFromEditorHistory', [id])
    editorHistory.value = editorHistory.value.filter((item) => item.id !== id)

    return removed
  }

  /** Puts a removed entry back to its place. */
  const restoreEditorItem = async (item: EditorHistoryItem): Promise<void> => {
    await track(call('restoreEditorHistoryItem', [item]))
    await loadEditorHistory()
  }

  const removeFromChatHistory = async (
    id: string
  ): Promise<ChatHistoryItem | null> => {
    const removed = await loadChat(id)

    await call('removeFromChatHistory', [id])
    chatHistory.value = chatHistory.value.filter((item) => item.id !== id)

    return removed
  }

  const restoreChatItem = async (item: ChatHistoryItem): Promise<void> => {
    await call('saveChatHistory', [item])
    await loadChatHistory()
  }

  const clearEditorHistory = async (): Promise<void> => {
    await call('clearEditorHistory')
    editorHistory.value = []
  }

  const clearChatHistory = async (): Promise<void> => {
    await call('clearChatHistory')
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
    restoreChatItem,
    clearEditorHistory,
    clearChatHistory,
  }
}
