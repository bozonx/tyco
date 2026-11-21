import type {
  ChatHistoryConfig,
  UserConfig,
  VaultChatHistory,
} from '@tyco/shared'
import { historyRetentionChoices } from '../history/history-retention'

/**
 * Retention periods offered by the settings; 0 is the choice that keeps the
 * chats forever, saved as no `retentionDays`
 */
const CHAT_HISTORY_RETENTION_DAYS = [0, 7, 30, 90, 365] as const

/** Whose chats a history setting governs: "Ask AI" or every profile */
export type ChatHistoryScope = 'askAi' | 'profiles'

type ChatHistorySettingsSource = Pick<UserConfig, 'chat' | 'aiProfiles'>

/** The history settings of one scope, as the config stores them */
export function chatHistoryConfig(
  config: ChatHistorySettingsSource,
  scope: ChatHistoryScope
): ChatHistoryConfig {
  return scope === 'profiles'
    ? config.aiProfiles.chatHistory
    : config.chat.history
}

/**
 * Chats are saved unless the settings turn it off. A profile chat follows the
 * settings of its workspace, `vaultHistory`, over the default of all profiles;
 * "Ask AI" its own
 */
export function isChatHistoryEnabled(
  config: ChatHistorySettingsSource,
  profileId?: string | null,
  vaultHistory?: VaultChatHistory
): boolean {
  if (profileId && vaultHistory?.storage) return vaultHistory.storage !== 'off'
  const scope: ChatHistoryScope = profileId ? 'profiles' : 'askAi'
  const history = chatHistoryConfig(config, scope)
  return history.storage !== 'off' && history.isChatSavingEnabled !== false
}

/** The offered retention periods plus the saved one if it is not among them */
export function chatHistoryRetentionChoices(saved: unknown): number[] {
  return historyRetentionChoices(CHAT_HISTORY_RETENTION_DAYS, saved)
}

/**
 * Quick requests are stored with the chats of their scope when chat saving is
 * enabled and the settings do not turn quick requests off; saving is the
 * default, kept as no field
 */
export function isQuickRequestSavingEnabled(
  config: ChatHistorySettingsSource,
  profileId?: string | null,
  vaultHistory?: VaultChatHistory
): boolean {
  if (!isChatHistoryEnabled(config, profileId, vaultHistory)) {
    return false
  }
  const scope: ChatHistoryScope = profileId ? 'profiles' : 'askAi'
  const history = chatHistoryConfig(config, scope)
  return history.isQuickRequestSavingEnabled !== false
}
