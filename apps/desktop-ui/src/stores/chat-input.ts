import { defineStore, getActivePinia, type Pinia } from 'pinia'

import { createChatInputModel } from '../lib/chat/chat-input-model'

/** The input of "Ask AI" */
export const useChatInputStore = defineStore('chatInput', createChatInputModel)

export type ChatInputStore = ReturnType<typeof useChatInputStore>

const profileInputStores = new Map<string, typeof useChatInputStore>()

const profileInputStoreId = (profileId: string) =>
  `chatInput-profile:${profileId}`

/** Each profile chat keeps its own draft */
export function useProfileChatInputStore(
  profileId: string,
  pinia?: Pinia
): ChatInputStore {
  let definition = profileInputStores.get(profileId)
  if (!definition) {
    definition = defineStore(
      profileInputStoreId(profileId),
      createChatInputModel
    ) as unknown as typeof useChatInputStore
    profileInputStores.set(profileId, definition)
  }
  return definition(pinia)
}

/** Disposes and forgets the input draft store of a removed profile */
export function disposeProfileChatInputStore(profileId: string, pinia?: Pinia) {
  const active = pinia ?? getActivePinia()
  const definition = profileInputStores.get(profileId)
  if (!active || !definition) return
  const id = profileInputStoreId(profileId)
  if (!(id in active.state.value)) return
  const store = definition(active)
  store.$dispose()
  delete active.state.value[id]
}
