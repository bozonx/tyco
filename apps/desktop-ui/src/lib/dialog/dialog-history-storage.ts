import type {
  Dialog,
  DialogHistoryConfig,
  DialogSummary,
  UserConfig,
} from '@tyco/shared'

import { createHistoryCall, type HistoryApi } from '../history/history-call'
import { historyRetentionChoices } from '../history/history-retention'

const DIALOG_RETENTION_DAYS = [0, 7, 30, 90, 365] as const

export function dialogHistoryConfig(
  userConfig?: UserConfig | null
): DialogHistoryConfig {
  return userConfig?.dialog?.history ?? { storage: 'disk' }
}

export function isDialogHistoryEnabled(
  userConfig?: UserConfig | null
): boolean {
  return dialogHistoryConfig(userConfig).storage === 'disk'
}

export function dialogHistoryRetentionChoices(current?: number): number[] {
  return historyRetentionChoices(DIALOG_RETENTION_DAYS, current)
}

export interface DialogStorageDriver {
  listDialogs(): Promise<DialogSummary[]>
  getDialog(id: string): Promise<Dialog | null>
  saveDialog(dialog: Dialog): Promise<void>
  renameDialog(id: string, title: string): Promise<void>
  deleteDialog(id: string): Promise<Dialog | null>
  releaseDialogRecordings(id: string): Promise<void>
  searchDialogs(query: string): Promise<string[]>
  clearDialogs(): Promise<void>
}

export function createIpcDialogStorageDriver(
  historyApi: HistoryApi
): DialogStorageDriver {
  const call = createHistoryCall(historyApi)

  return {
    async listDialogs(): Promise<DialogSummary[]> {
      const result = await call('list_dialogs')
      return result || []
    },
    async getDialog(id: string): Promise<Dialog | null> {
      const result = await call('get_dialog', { id })
      return result || null
    },
    async saveDialog(dialog: Dialog): Promise<void> {
      await call('save_dialog', { dialog })
    },
    async renameDialog(id: string, title: string): Promise<void> {
      await call('rename_dialog', { id, title })
    },
    async deleteDialog(id: string): Promise<Dialog | null> {
      return (await call('delete_dialog', { id })) || null
    },
    async releaseDialogRecordings(id: string): Promise<void> {
      await call('release_dialog_recordings', { id })
    },
    async searchDialogs(query: string): Promise<string[]> {
      const result = await call('search_dialogs', { query })
      return result || []
    },
    async clearDialogs(): Promise<void> {
      await call('clear_dialogs')
    },
  }
}
