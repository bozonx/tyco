import { llmSecretId } from '@tyco/shared'
import { defineStore, getActivePinia, type Pinia } from 'pinia'
import { nextTick, onScopeDispose, watch } from 'vue'

import useToast from '../composables/use-toast'
import { createIpcChatSessionStorageDriver } from '../lib/chat/chat-session-storage'
import { createChatStoreRuntime } from '../lib/chat/chat-store-runtime'
import { invokeDesktop } from '../lib/desktop/invoke'
import { getDesktopWindowLabel } from '../lib/desktop/window'
import { createChatHistoryModel } from '../lib/history/chat-history'
import { translate } from '../lib/i18n'
import { clientLogger } from '../lib/logger'
import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { isSecretUsable } from '../lib/net/secrets'
import { useAiProfilesStore } from './ai-profiles'
import {
  disposeProfileChatInputStore,
  useChatInputStore,
  useProfileChatInputStore,
} from './chat-input'
import { useDesktopStore } from './desktop'
import { useEditorInputStore } from './editor-input'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useLlmStore } from './llm'
import { useMenuModalsStore } from './menu-modals'
import { useSecretsStore } from './secrets'
import { useToolsStore } from './tools'

/**
 * One chat: "Ask AI" when `profileId` is null, a profile chat otherwise. Each
 * has its own conversation, draft and history; nothing of one reaches the
 * other. A profile chat follows its `SOUL.md` and settings only: the
 * instructions and rules of "Ask AI" do not apply to it.
 */
function createChatStoreSetup(profileId: string | null) {
  return () => {
    const { toastKey, toastText } = useToast()
    const ipcStore = useIpcStore()
    const desktopStore = useDesktopStore()
    const llmStore = useLlmStore()
    const secretsStore = useSecretsStore()
    const aiProfilesStore = useAiProfilesStore()
    if (profileId) {
      const pinia = getActivePinia()
      // a removed profile takes its chat and draft along, before its files go
      aiProfilesStore.$onAction(({ name, args }) => {
        if (name === 'deleteProfile' && args[0] === profileId)
          disposeProfileChatStore(profileId, pinia)
      })
    }
    const editorInputStore = useEditorInputStore()
    const chatInputStore = profileId
      ? useProfileChatInputStore(profileId)
      : useChatInputStore()
    const menuModalsStore = useMenuModalsStore()
    const profileHistory = profileId
      ? createChatHistoryModel(
          createIpcChatSessionStorageDriver(ipcStore, profileId)
        )
      : null
    const history = profileHistory ?? useHistoryStore()

    const { dispose, ...runtime } = createChatStoreRuntime({
      profileId,
      invoke: invokeDesktop,
      history,
      getFallbackProfileChatId: () => profileHistory?.chatHistory.value[0]?.id,
      llmActions: llmStore.actions,
      editor: editorInputStore,
      input: chatInputStore,
      getProfile: (id) => aiProfilesStore.getProfile(id),
      refreshProfile: (id) => aiProfilesStore.refreshProfile(id),
      readSoul: (id) => aiProfilesStore.readSoul(id),
      updateProfileModel: (id, modelId) =>
        aiProfilesStore.updateProfile(id, { modelId }),
      getUserConfig: () => desktopStore.userConfig,
      getAppConfig: () => desktopStore.appConfig,
      getSessionState: () => desktopStore.sessionState,
      saveSessionState: desktopStore.patchSessionState,
      hasSecret: (providerId) =>
        isSecretUsable(secretsStore.secrets, llmSecretId(providerId)),
      externalSelection: () => desktopStore.desktopState.selectedText,
      windowLabel: getDesktopWindowLabel,
      openMainChat: (attachment) =>
        ipcStore.callFunctionOrNotify('openMainChat', [attachment]),
      closeModals: menuModalsStore.closeAll,
      afterRender: nextTick,
      navigateTo: async (path) => {
        if (profileId && path === APP_ROUTES.CHAT.path) {
          const isShown =
            appNavigation.isCurrent(APP_ROUTES.CHAT.path) &&
            appNavigation.currentProfileId() === profileId
          if (!isShown) await appNavigation.goToProfileChat(profileId)
          return
        }
        await appNavigation.push(path)
      },
      translate,
      toastText,
      toastKey,
      warn: (message) => clientLogger.warn(message, 'chat'),
    })

    onScopeDispose(dispose)

    watch(
      () => desktopStore.desktopState.isWindowShown,
      (isShown) => {
        if (!isShown) runtime.markEditorSelectionStale()
      }
    )

    // "Ask AI" is the chat of `core.askInChat`
    if (!profileId)
      onScopeDispose(
        useToolsStore().provideAskInChat((text) => runtime.attachToChat(text))
      )

    return runtime
  }
}

/** "Ask AI": the chat the editor, the tools and the quick window talk to */
export const useChatStore = defineStore('chat', createChatStoreSetup(null))

export type ChatStore = ReturnType<typeof useChatStore>

const profileChatStores = new Map<string, typeof useChatStore>()

const profileChatStoreId = (profileId: string) => `chat-profile:${profileId}`

/** The chat of a profile; it lives on while the user is elsewhere */
export function useProfileChatStore(
  profileId: string,
  pinia?: Pinia
): ChatStore {
  let definition = profileChatStores.get(profileId)
  if (!definition) {
    definition = defineStore(
      profileChatStoreId(profileId),
      createChatStoreSetup(profileId)
    ) as unknown as typeof useChatStore
    profileChatStores.set(profileId, definition)
  }
  return definition(pinia)
}

/** Stops and forgets the chat and input draft of a removed profile */
export function disposeProfileChatStore(profileId: string, pinia?: Pinia) {
  const active = pinia ?? getActivePinia()
  if (!active) return
  disposeProfileChatInputStore(profileId, active)
  const definition = profileChatStores.get(profileId)
  if (!definition) return
  const id = profileChatStoreId(profileId)
  // a store only exists once something used it
  if (!(id in active.state.value)) return
  const store = definition(active)
  store.stopGeneration()
  store.$dispose()
  delete active.state.value[id]
}
