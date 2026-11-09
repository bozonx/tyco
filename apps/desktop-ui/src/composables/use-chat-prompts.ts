import { computed } from 'vue'

import {
  type ChatPromptView,
  describeChatPrompts,
} from '../lib/chat-prompts/chat-prompts'
import { useAiProfilesStore } from '../stores/ai-profiles'
import { useDesktopStore } from '../stores/desktop'

/** The prompts that can run, with the names of their profiles */
export function useChatPrompts() {
  const desktopStore = useDesktopStore()
  const aiProfilesStore = useAiProfilesStore()

  if (!aiProfilesStore.isLoaded) void aiProfilesStore.loadAll()

  const views = computed<ChatPromptView[]>(() =>
    describeChatPrompts(desktopStore.userConfig.chatPrompts?.items, {
      profiles: aiProfilesStore.profiles,
      areProfilesLoaded: aiProfilesStore.isLoaded,
      connectedVaultIds: aiProfilesStore.connectedVaultIds,
    })
  )

  return { views }
}
