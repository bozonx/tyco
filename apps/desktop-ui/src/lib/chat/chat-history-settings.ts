import { historyRetentionChoices } from '../history/history-retention'

/** Retention periods offered by the settings; 0 keeps the chats forever */
export const CHAT_HISTORY_RETENTION_DAYS = [0, 7, 30, 90, 365] as const

/** Chats are saved unless the settings turn it off */
export function isChatHistoryEnabled(
  config: { chatHistoryEnabled?: boolean } | undefined
): boolean {
  return config?.chatHistoryEnabled !== false
}

/** The offered retention periods plus the saved one if it is not among them */
export function chatHistoryRetentionChoices(saved: unknown): number[] {
  return historyRetentionChoices(CHAT_HISTORY_RETENTION_DAYS, saved)
}
