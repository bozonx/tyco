import type { ChatHistoryConfig, VaultChatHistory } from '@tyco/shared'

import { isStricterRetention } from '../history/history-retention'

/** A choice that follows the chat settings of the app */
export const WORKSPACE_DEFAULT = 'default'

export type WorkspaceSavingChoice = typeof WORKSPACE_DEFAULT | 'disk' | 'off'

/** The chat settings of the app save chats */
export const isDefaultSaving = (defaults: ChatHistoryConfig): boolean =>
  defaults.storage !== 'off'

/** The chats of the workspace are saved, by its own setting or the default */
export function isWorkspaceSaving(
  history: VaultChatHistory,
  defaults: ChatHistoryConfig
): boolean {
  return history.storage ? history.storage !== 'off' : isDefaultSaving(defaults)
}

/** How many days the chats of the workspace are kept; 0 forever */
export const workspaceRetentionDays = (
  history: VaultChatHistory,
  defaults: ChatHistoryConfig
): number => history.retentionDays ?? defaults.retentionDays ?? 0

export const savingChoice = (
  history: VaultChatHistory
): WorkspaceSavingChoice => history.storage ?? WORKSPACE_DEFAULT

/** The settings with the saving choice applied */
export function withSaving(
  history: VaultChatHistory,
  choice: WorkspaceSavingChoice
): VaultChatHistory {
  const { storage: _storage, ...rest } = history
  return choice === WORKSPACE_DEFAULT ? rest : { ...rest, storage: choice }
}

/** The retention choice: the default or a number of days as text */
export const retentionChoice = (history: VaultChatHistory): string =>
  history.retentionDays === undefined
    ? WORKSPACE_DEFAULT
    : String(history.retentionDays)

/**
 * The settings with the retention choice applied, or `null` for a choice that
 * is not one; `isStricter` tells that it removes chats the workspace keeps now
 */
export function withRetention(
  history: VaultChatHistory,
  defaults: ChatHistoryConfig,
  choice: string
): { history: VaultChatHistory; isStricter: boolean } | null {
  const { retentionDays: _days, ...rest } = history
  let next: VaultChatHistory
  if (choice === WORKSPACE_DEFAULT) next = rest
  else {
    const days = Number(choice)
    if (!Number.isSafeInteger(days) || days < 0) return null
    next = { ...rest, retentionDays: days }
  }
  return {
    history: next,
    isStricter: isStricterRetention(
      workspaceRetentionDays(history, defaults),
      workspaceRetentionDays(next, defaults)
    ),
  }
}
