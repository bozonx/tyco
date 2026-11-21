import { ref } from 'vue'
import type {
  EditorHistoryEntry,
  EditorHistoryFailure,
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
  // false until the first load finished, so that "no entries" is not shown
  // for a list that has merely not arrived yet
  const isEditorHistoryLoaded = ref(false)

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
    isEditorHistoryLoaded.value = true
  }

  /** Resolves to the id of the stored entry, null when nothing was stored. */
  const saveEditorHistory = async (
    entry: EditorHistoryEntry
  ): Promise<string | null> => {
    // Intentional: with the history turned off nothing the user typed or
    // dictated is kept, here or anywhere else; it is the user's choice. The
    // backend checks the same setting again. A recorded dialog is kept before
    // anything was recognized: its entry is the way back to the file
    const isRecordedDialog = Boolean(entry.dialog?.recordingFile)
    if (!canRecord() || (!entry.text.trim() && !isRecordedDialog)) return null

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
    instruction?: EditorHistoryInstruction,
    profileId?: string
  ) =>
    saveEditorHistory({
      text,
      kind: 'source',
      operation,
      ...(origin && { origin }),
      ...(instruction && { instruction }),
      ...(profileId && { profileId }),
    })

  /** Remembers what the AI made of the `source` entry `id`. */
  const saveSourceResult = async (
    id: string | null,
    result: string
  ): Promise<void> => {
    if (!canRecord() || !id) return

    await track(call('set_editor_history_item_result', { id, result }))
  }

  /** Remembers why the AI produced nothing for the `source` entry `id`. */
  const saveSourceFailure = async (
    id: string | null,
    failure: EditorHistoryFailure
  ): Promise<void> => {
    if (!canRecord() || !id) return

    await track(call('set_editor_history_item_failure', { id, failure }))
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

  /**
   * The undo of a removal is over: the recording of a removed dialog goes too,
   * unless an entry names it again
   */
  const releaseEditorItem = async (item: EditorHistoryItem): Promise<void> => {
    const file = item.dialog?.recordingFile
    if (!file) return
    await track(call('discard_dialog_recording', { file }))
  }

  const clearEditorHistory = async (): Promise<void> => {
    await track(call('clear_editor_history'))
    editorListVersion += 1
    editorHistory.value = []
  }

  return {
    editorHistory,
    isEditorHistoryLoaded,
    loadEditorHistory,
    saveEditorHistory,
    saveOutput,
    onOutput,
    saveSource,
    saveSourceResult,
    saveSourceFailure,
    removeFromEditorHistory,
    restoreEditorItem,
    releaseEditorItem,
    clearEditorHistory,
  }
}
