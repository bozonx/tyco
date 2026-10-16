import { inject, provide, type InjectionKey } from 'vue'

import {
  useChatStore,
  useProfileChatStore,
  type ChatStore,
} from '../stores/chat'
import {
  useChatInputStore,
  useProfileChatInputStore,
  type ChatInputStore,
} from '../stores/chat-input'

/** The chat a part of the chat view works with and its input */
export interface ChatScope {
  chat: ChatStore
  input: ChatInputStore
}

const CHAT_SCOPE_KEY: InjectionKey<() => ChatScope> = Symbol('chat-scope')

/** The chat of a profile, or "Ask AI" without one */
export function resolveChatScope(profileId: string | null): ChatScope {
  return profileId
    ? {
        chat: useProfileChatStore(profileId),
        input: useProfileChatInputStore(profileId),
      }
    : { chat: useChatStore(), input: useChatInputStore() }
}

/**
 * Gives the chat view's parts the chat it shows. They read it once, so the view
 * remounts them when it shows another chat
 */
export function provideChatScope(getScope: () => ChatScope) {
  provide(CHAT_SCOPE_KEY, getScope)
}

/**
 * The profile of the chat shown around the caller, without creating any store;
 * undefined for "Ask AI" and outside the chat view
 */
export function useChatScopeProfileId(): string | undefined {
  const getScope = inject(CHAT_SCOPE_KEY, null)
  return getScope?.().chat.profileId ?? undefined
}

/** The chat shown around the caller; "Ask AI" outside the chat view */
export function useChatScope(): ChatScope {
  const getScope = inject(CHAT_SCOPE_KEY, null)
  return getScope ? getScope() : resolveChatScope(null)
}
