import { computed, unref } from 'vue'

import { useHistoryStore } from '../stores/history'

/**
 * The chats the chat settings govern, those of "Ask AI", counted and cleared;
 * the chats of profiles follow the settings of their workspace
 */
export function useSettingsHistoryChats() {
  const historyStore = useHistoryStore()
  return {
    count: computed(() => unref(historyStore.chatHistory)?.length ?? 0),
    load: async () => {
      await historyStore.loadChatHistory?.()
    },
    clear: () => historyStore.clearChats(),
  }
}
