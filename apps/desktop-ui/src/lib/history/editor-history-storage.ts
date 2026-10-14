import { historyRetentionChoices } from './history-retention'

/** Retention periods offered by the settings; 0 keeps the entries forever */
const EDITOR_HISTORY_RETENTION_DAYS = [0, 1, 7, 30, 90] as const

/** The editor history keeps nothing */
export function isEditorHistoryOff(config: Record<string, unknown>): boolean {
  return (
    config.editorHistoryStorage === 'off' ||
    String(config.editorHistoryMaxItems ?? '').trim() === '0'
  )
}

/** The offered retention periods plus the saved one if it is not among them */
export function editorHistoryRetentionChoices(saved: unknown): number[] {
  return historyRetentionChoices(EDITOR_HISTORY_RETENTION_DAYS, saved)
}
