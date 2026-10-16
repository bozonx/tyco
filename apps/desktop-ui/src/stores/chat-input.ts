import { defineStore } from 'pinia'

import { createChatInputModel } from '../lib/chat/chat-input-model'

/** The input of "Ask AI" */
export const useChatInputStore = defineStore('chatInput', createChatInputModel)

export type ChatInputStore = ReturnType<typeof useChatInputStore>

const profileInputStores = new Map<string, typeof useChatInputStore>()

/** Each profile chat keeps its own draft */
export function useProfileChatInputStore(profileId: string): ChatInputStore {
  let definition = profileInputStores.get(profileId)
  if (!definition) {
    definition = defineStore(
      `chatInput-profile:${profileId}`,
      createChatInputModel
    ) as unknown as typeof useChatInputStore
    profileInputStores.set(profileId, definition)
  }
  return definition()
}
