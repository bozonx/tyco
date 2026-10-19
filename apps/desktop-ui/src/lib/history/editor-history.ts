import { ref } from 'vue'
import type {
  EditorHistoryEntry,
  EditorHistoryItem,
  EditorHistoryOperation,
} from '@tyco/shared'
import type { HistoryApi } from './history-call'
import { createHistoryCall } from './history-call'

export function createEditorHistoryModel(historyApi: HistoryApi) {
  const call = createHistoryCall(historyApi)

  const editorHistory = ref<EditorHistoryItem[]>([])

  // writes still on their way: a load must not overtake them, otherwise the
  // text saved on the way to the history page would be missing from it
  const pendingWrites = new Set<Promise<unknown>>()

  let editorListVersion = 0

  const track = <T>(write: Promise<T>): Promise<T> => {
    pendingWrites.add(write)
    void write.finally(() => pendingWrites.delete(write)).catch(() => {})

    return write
  }

  const loadEditorHistory = async (): Promise<void> => {
    const version = ++editorListVersion
    await Promise.allSettled([...pendingWrites])

    const loadedHistory = await call('get_editor_history')
    if (version === editorListVersion) editorHistory.value = loadedHistory || []
  }

  /** Resolves to the id of the stored entry, null when nothing was stored. */
  const saveEditorHistory = async (
    entry: EditorHistoryEntry
  ): Promise<string | null> => {
    if (!entry.text.trim()) return null

    const saved = await track(call('add_editor_history_item', { entry }))

    return typeof saved === 'string' ? saved : null
  }

  /** The text is leaving the app: inserted into a window or copied. */
  const saveOutput = (text: string) =>
    saveEditorHistory({ text, kind: 'output' })

  /** The text is about to be replaced by the result of an AI operation. */
  const saveSource = (text: string, operation: EditorHistoryOperation) =>
    saveEditorHistory({ text, kind: 'source', operation })

  /** Remembers what the AI made of the `source` entry `id`. */
  const saveSourceResult = async (
    id: string | null,
    result: string
  ): Promise<void> => {
    if (!id) return

    await track(call('set_editor_history_item_result', { id, result }))
  }

  /** Resolves to the removed entry, so that the removal can be undone. */
  const removeFromEditorHistory = async (
    id: string
  ): Promise<EditorHistoryItem | null> => {
    const removed = editorHistory.value.find((item) => item.id === id) ?? null

    await track(call('delete_editor_history_item', { id }))
    editorListVersion += 1
    editorHistory.value = editorHistory.value.filter((item) => item.id !== id)

    return removed
  }

  /** Puts a removed entry back to its place. */
  const restoreEditorItem = async (item: EditorHistoryItem): Promise<void> => {
    await track(call('restore_editor_history_item', { item }))
    await loadEditorHistory()
  }

  const clearEditorHistory = async (): Promise<void> => {
    await track(call('clear_editor_history'))
    editorListVersion += 1
    editorHistory.value = []
  }
  return {
    editorHistory,
    loadEditorHistory,
    saveEditorHistory,
    saveOutput,
    saveSource,
    saveSourceResult,
    removeFromEditorHistory,
    restoreEditorItem,
    clearEditorHistory,
  }
}
