import { computed, onScopeDispose, ref, unref, watch } from 'vue'

import { useAiProfilesStore } from '../stores/ai-profiles'
import { useHistoryStore } from '../stores/history'

/**
 * The chats the chat settings govern, counted and cleared together: those of
 * "Ask AI" and those of every profile
 */
export function useSettingsHistoryChats() {
  const historyStore = useHistoryStore()
  const aiProfilesStore = useAiProfilesStore()
  const profileCount = ref(0)
  let countRequest = 0
  let isDisposed = false
  onScopeDispose(() => {
    isDisposed = true
    countRequest += 1
  })
  const refreshProfiles = async () => {
    if (isDisposed) return
    const request = ++countRequest
    try {
      const total = await aiProfilesStore.countAllProfileChats()
      if (request === countRequest) profileCount.value = total
    } catch {
      // the count stays as last read
    }
  }
  // the profiles are listed once the vault is read
  watch(
    () => aiProfilesStore.profiles.map(({ id }) => id).join('\n'),
    () => void refreshProfiles()
  )
  const askAiCount = computed(
    () => unref(historyStore.chatHistory)?.length ?? 0
  )
  return {
    count: computed(() => askAiCount.value + profileCount.value),
    load: async () => {
      await Promise.all([historyStore.loadChatHistory?.(), refreshProfiles()])
    },
    clear: async () => {
      countRequest += 1
      try {
        await Promise.all([
          historyStore.clearChats(),
          aiProfilesStore.clearAllProfileChats(),
        ])
      } finally {
        void refreshProfiles()
      }
    },
  }
}
