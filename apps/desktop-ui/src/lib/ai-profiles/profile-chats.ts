import type { ChatSessionStorageDriver } from '../chat/chat-session-storage'

export interface ProfileChatsDependencies {
  /** The profiles known now; each keeps its chats in its own folder */
  listProfileIds: () => readonly string[]
  storageFor: (
    profileId: string
  ) => Pick<ChatSessionStorageDriver, 'listChats' | 'clearChats'>
}

/** The chats of every profile at once, as the shared settings handle them */
export function createProfileChatsModel(deps: ProfileChatsDependencies) {
  /** How many chats the profiles keep altogether */
  const countAll = async (): Promise<number> => {
    const counts = await Promise.all(
      deps
        .listProfileIds()
        .map(async (id) => (await deps.storageFor(id).listChats()).length)
    )
    return counts.reduce((total, count) => total + count, 0)
  }

  /**
   * Removes the chats of every profile. All profiles are tried; the first
   * failure is reported once the rest are done
   */
  const clearAll = async (): Promise<void> => {
    const results = await Promise.allSettled(
      deps.listProfileIds().map((id) => deps.storageFor(id).clearChats())
    )
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failure) throw failure.reason
  }

  return { countAll, clearAll }
}
