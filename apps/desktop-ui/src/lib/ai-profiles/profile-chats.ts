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
  /**
   * How many chats the profiles keep altogether; a profile whose chats cannot
   * be read counts none, the rest still count. Fails only when none is read
   */
  const countAll = async (): Promise<number> => {
    const ids = deps.listProfileIds()
    const results = await Promise.allSettled(
      ids.map(async (id) => (await deps.storageFor(id).listChats()).length)
    )
    let total = 0
    let failure: PromiseRejectedResult | undefined
    for (const result of results) {
      if (result.status === 'fulfilled') total += result.value
      else failure ??= result
    }
    if (failure && results.every((result) => result.status === 'rejected'))
      throw failure.reason
    return total
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
