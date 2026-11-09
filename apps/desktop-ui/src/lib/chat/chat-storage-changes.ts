import type { StorageChangedEvent } from '@tyco/shared'

import { splitRef } from '../ai-profiles/profile-ref'

/**
 * The files of a chat history that changed, relative to its folder: the chats
 * of "Ask AI" (`profileKey` null) in the data folder, or those of a profile in
 * its vault
 */
export function changedChatFiles(
  event: StorageChangedEvent,
  profileKey: string | null
): string[] {
  if (!profileKey)
    return event.paths
      .filter((path) => path.startsWith('chats/'))
      .map((path) => path.slice('chats/'.length))
  const { vaultId, id } = splitRef(profileKey)
  const prefix = `profiles/${id}/chats/`
  return event.vaultChanges
    .filter(
      (change) => change.vaultId === vaultId && change.path.startsWith(prefix)
    )
    .map((change) => change.path.slice(prefix.length))
}
