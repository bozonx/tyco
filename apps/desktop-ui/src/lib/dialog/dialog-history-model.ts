import type { Dialog, DialogSummary } from '@tyco/shared'
import { ref } from 'vue'

import { createRemovalUndo } from '../history/removal-undo'
import type { DialogStorageDriver } from './dialog-history-storage'

export interface DialogHistoryModelDependencies {
  storage: DialogStorageDriver
  isHistoryEnabled: () => boolean
  reportError: (error: unknown) => void
  timeoutMs?: number
}

/**
 * Manages the saved dialog history list, full-text search, renaming, clearing,
 * and undoable deletion (deferring audio folder removal until undo expires).
 */
export function createDialogHistoryModel(deps: DialogHistoryModelDependencies) {
  const dialogs = ref<DialogSummary[]>([])
  const isLoaded = ref(false)
  const pendingWrites = new Set<Promise<unknown>>()
  let listVersion = 0

  const track = <T>(write: Promise<T>): Promise<T> => {
    pendingWrites.add(write)
    void write.finally(() => pendingWrites.delete(write)).catch(() => {})
    return write
  }

  const loadDialogs = async (): Promise<void> => {
    const version = ++listVersion
    await Promise.allSettled([...pendingWrites])
    const loaded = await deps.storage.listDialogs()
    if (version === listVersion) dialogs.value = loaded
    isLoaded.value = true
  }

  const getDialog = (id: string): Promise<Dialog | null> =>
    deps.storage.getDialog(id)

  const saveDialog = async (dialog: Dialog): Promise<void> => {
    await track(deps.storage.saveDialog(dialog))
    await loadDialogs()
  }

  const renameDialog = async (id: string, title: string): Promise<void> => {
    await track(deps.storage.renameDialog(id, title))
    const trimmed = title.trim()
    dialogs.value = dialogs.value.map((item) =>
      item.id === id ? { ...item, title: trimmed } : item
    )
  }

  const searchDialogs = (query: string): Promise<string[]> =>
    deps.storage.searchDialogs(query)

  const restoredIds = new Set<string>()

  const removal = createRemovalUndo<Dialog>({
    remove: async (id) => {
      const removed = await track(deps.storage.deleteDialog(id))
      listVersion += 1
      dialogs.value = dialogs.value.filter((item) => item.id !== id)
      return removed
    },
    restore: async (dialog) => {
      if (!deps.isHistoryEnabled()) {
        throw new Error('Dialog history is off; the dialog was not restored')
      }
      await track(deps.storage.saveDialog(dialog))
      restoredIds.add(dialog.id)
      await loadDialogs()
    },
    release: (dialog) => {
      if (restoredIds.delete(dialog.id)) return Promise.resolve()
      return track(deps.storage.releaseDialogRecordings(dialog.id))
    },
    clear: async () => {
      await track(deps.storage.clearDialogs())
      listVersion += 1
      dialogs.value = []
    },
    reportError: deps.reportError,
    timeoutMs: deps.timeoutMs,
  })

  return {
    dialogs,
    isLoaded,
    removedDialog: removal.removed,
    loadDialogs,
    getDialog,
    saveDialog,
    renameDialog,
    searchDialogs,
    removeDialog: removal.remove,
    undoRemoveDialog: removal.undo,
    clearDialogs: removal.clear,
    dispose: removal.dispose,
  }
}
