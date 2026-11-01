import { computed, onScopeDispose, ref, unref, watch } from 'vue'

import type { ChatHistoryScope } from '../lib/chat/chat-history-settings'
import { useAiProfilesStore } from '../stores/ai-profiles'
import { useHistoryStore } from '../stores/history'

/** What the chats of the scope are counted and cleared with */
export function useSettingsHistoryChats(scope: ChatHistoryScope) {
  if (scope === 'profiles') {
    const aiProfilesStore = useAiProfilesStore()
    const count = ref(0)
    let countRequest = 0
    let isDisposed = false
    onScopeDispose(() => {
      isDisposed = true
      countRequest += 1
    })
    const refresh = async () => {
      if (isDisposed) return
      const request = ++countRequest
      try {
        const total = await aiProfilesStore.countAllProfileChats()
        if (request === countRequest) count.value = total
      } catch {
        // the count stays as last read
      }
    }
    // the profiles are listed once the vault is read
    watch(
      () => aiProfilesStore.profiles.map(({ id }) => id).join('\n'),
      () => void refresh()
    )
    return {
      count,
      load: refresh,
      clear: async () => {
        countRequest += 1
        try {
          await aiProfilesStore.clearAllProfileChats()
        } finally {
          void refresh()
        }
      },
    }
  }
  const historyStore = useHistoryStore()
  return {
    count: computed(() => unref(historyStore.chatHistory)?.length ?? 0),
    load: async () => {
      await historyStore.loadChatHistory?.()
    },
    clear: () => historyStore.clearChats(),
  }
}
