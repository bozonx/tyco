import type { UserConfig } from '@tyco/shared'
import { historyRetentionChoices } from './history-retention'

/**
 * Retention periods offered by the settings; 0 is the choice that keeps the
 * entries forever, saved as no `retentionDays`
 */
const EDITOR_HISTORY_RETENTION_DAYS = [0, 1, 7, 30, 90, 365] as const

/** New entries are kept until the app quits only */
export function isEditorHistoryInSession(
  config: Pick<UserConfig, 'editor'>
): boolean {
  return config.editor.history.storage === 'session'
}

/** The offered retention periods plus the saved one if it is not among them */
export function editorHistoryRetentionChoices(saved: unknown): number[] {
  return historyRetentionChoices(EDITOR_HISTORY_RETENTION_DAYS, saved)
}
