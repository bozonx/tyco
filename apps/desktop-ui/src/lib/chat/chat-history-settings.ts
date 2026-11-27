import type { UserConfig, VaultChatHistory } from '@tyco/shared'
import { historyRetentionChoices } from '../history/history-retention'

/**
 * Retention periods offered by the settings; 0 is the choice that keeps the
 * chats forever, saved as no `retentionDays`
 */
const CHAT_HISTORY_RETENTION_DAYS = [0, 7, 30, 90, 365] as const

type ChatHistorySettingsSource = Pick<UserConfig, 'chat'>

/**
 * New chats are stored on disk, not only until the app quits. A profile chat
 * follows the settings of its workspace, `vaultHistory`, alone; "Ask AI" the
 * chat settings
 */
export function isChatHistoryOnDisk(
  config: ChatHistorySettingsSource,
  profileId?: string | null,
  vaultHistory?: VaultChatHistory
): boolean {
  if (profileId) return vaultHistory?.storage !== 'session'
  return config.chat.history.storage !== 'session'
}

/** The offered retention periods plus the saved one if it is not among them */
export function chatHistoryRetentionChoices(saved: unknown): number[] {
  return historyRetentionChoices(CHAT_HISTORY_RETENTION_DAYS, saved)
}

/**
 * Quick requests are kept with the chats unless the settings of the chat, or of
 * the workspace of a profile, turn them off; keeping is the default, kept as no
 * field
 */
export function isQuickRequestSavingEnabled(
  config: ChatHistorySettingsSource,
  profileId?: string | null,
  vaultHistory?: VaultChatHistory
): boolean {
  const history = profileId ? vaultHistory : config.chat.history
  return history?.isQuickRequestSavingEnabled !== false
}
