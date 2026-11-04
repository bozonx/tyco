import { ref } from 'vue'
import type {
  EditorHistoryEntry,
  EditorHistoryInstruction,
  EditorHistoryItem,
  EditorHistoryOperation,
  EditorHistoryOrigin,
} from '@tyco/shared'
import type { HistoryApi } from './history-call'
import { createHistoryCall } from './history-call'

export function createEditorHistoryModel(
  historyApi: HistoryApi,
  canRecord: () => boolean = () => true
) {
  const call = createHistoryCall(historyApi)

  const editorHistory = ref<EditorHistoryItem[]>([])

  // writes still on their way: a load must not overtake them, otherwise a
  // text saved just before the history page opened would be missing from it
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
    // Intentional: with the history turned off nothing the user typed or
    // dictated is kept, here or anywhere else; it is the user's choice. The
    // backend checks the same setting again
    if (!canRecord() || !entry.text.trim()) return null

    const saved = await track(call('add_editor_history_item', { entry }))

    return typeof saved === 'string' ? saved : null
  }

  const outputListeners = new Set<(text: string) => void>()

  /**
   * The text is leaving the app: inserted into a window or copied. Listeners
   * hear of it whether the history is on or off: e.g. the quick input then
   * counts its text as finished
   */
  const saveOutput = (text: string, origin?: EditorHistoryOrigin) => {
    for (const listener of outputListeners) listener(text)
    return saveEditorHistory({
      text,
      kind: 'output',
      ...(origin && { origin }),
    })
  }

  /**
   * Calls `listener` with every text that leaves the app; returns an
   * unsubscribe
   */
  const onOutput = (listener: (text: string) => void) => {
    outputListeners.add(listener)
    return () => {
      outputListeners.delete(listener)
    }
  }

  /** The text is about to be replaced by the result of an AI operation. */
  const saveSource = (
    text: string,
    operation: EditorHistoryOperation,
    origin?: EditorHistoryOrigin,
    instruction?: EditorHistoryInstruction
  ) =>
    saveEditorHistory({
      text,
      kind: 'source',
      operation,
      ...(origin && { origin }),
      ...(instruction && { instruction }),
    })

  /** Remembers what the AI made of the `source` entry `id`. */
  const saveSourceResult = async (
    id: string | null,
    result: string
  ): Promise<void> => {
    if (!canRecord() || !id) return

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
    // the undo keeps the item rather than losing it to a restore that did nothing
    if (!canRecord())
      throw new Error('Editor history is not recorded; nothing was restored')
    await track(call('restore_editor_history_item', { item }))
    await loadEditorHistory()
  }

  const clearEditorHistory = async (): Promise<void> => {
    await track(call('clear_editor_history'))
    editorListVersion += 1
    editorHistory.value = []
  }

  /**
   * Recent instructions from history from newest to oldest, without duplicates
   * (comparing after trim). Empty when recording is disabled.
   */
  const listRecentInstructions = (limit = 5): string[] => {
    if (!canRecord() || limit <= 0) return []

    const result: string[] = []
    const seen = new Set<string>()

    for (const item of editorHistory.value) {
      const instructionText = item.instruction?.text.trim()
      if (!instructionText) continue
      if (seen.has(instructionText)) continue

      seen.add(instructionText)
      result.push(instructionText)
      if (result.length >= limit) break
    }

    return result
  }

  return {
    editorHistory,
    loadEditorHistory,
    saveEditorHistory,
    saveOutput,
    onOutput,
    saveSource,
    saveSourceResult,
    removeFromEditorHistory,
    restoreEditorItem,
    clearEditorHistory,
    listRecentInstructions,
  }
}
